/**
 * wellread eve sidecar — loopback HTTP server (Reading Assistant v1).
 *
 * Speaks the 05/10 handshake: listen on 127.0.0.1 with PORT=0, print a
 * `Listening http://127.0.0.1:<port>/` line, require Bearer loopback token,
 * expose GET /eve/v1 for readiness + session/chat APIs under /eve/v1/*.
 */

import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { createOpenAI } from '@ai-sdk/openai';
import {
  createLanguageModel,
  normalizeModelEnv,
  normalizeThinkingMode,
} from '../createModel.mjs';
import { createHttpAbort } from '../agent/httpAbort.mjs';
import { createSessionStore } from '../agent/sessionStore.mjs';
import { runTurn } from '../agent/runTurn.mjs';
import { discoverSkills } from '../agent/skills/discover.mjs';
import { resolveLoopbackToken } from './loopbackToken.mjs';
import {
  BadJsonError,
  RequestBodyTooLargeError,
  readJson,
} from './readJson.mjs';
import {
  TURN_IN_FLIGHT_BODY,
  createTurnInFlightGate,
} from './turnInFlight.mjs';

const HOST = '127.0.0.1';

const tokenResult = resolveLoopbackToken(process.env);
if (!tokenResult.ok) {
  console.error(tokenResult.reason);
  process.exit(1);
}
const token = tokenResult.token;

const dataDir = process.env.EVE_DATA_DIR || './.eve-data';
const booksRootEnv = (process.env.EVE_BOOKS_ROOT || '').trim();

mkdirSync(dataDir, { recursive: true });

const modelConfig = normalizeModelEnv({
  baseURL: process.env.EVE_MODEL_BASE_URL,
  apiKey: process.env.EVE_MODEL_API_KEY,
  modelId: process.env.EVE_MODEL_ID,
  contextWindowTokens: process.env.EVE_MODEL_CONTEXT_WINDOW,
  apiMode: process.env.EVE_MODEL_API_MODE,
});

let languageModel = null;
let modelContextWindowTokens = modelConfig.contextWindowTokens;
let modelReady = false;
let modelError = '';
try {
  const built = createLanguageModel(modelConfig, { createOpenAI });
  languageModel = built.model;
  modelContextWindowTokens = built.modelContextWindowTokens;
  modelReady = Boolean(modelConfig.apiKey);
} catch (error) {
  modelError = error instanceof Error ? error.message : String(error);
}

const sessions = createSessionStore(dataDir);
const turnGate = createTurnInFlightGate();

function getBooksRoot() {
  if (!booksRootEnv) {
    throw new Error('EVE_BOOKS_ROOT is not set');
  }
  return booksRootEnv;
}

function unauthorized(res, req) {
  res.writeHead(401, {
    'content-type': 'application/json',
    ...corsHeaders(req),
  });
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

function corsHeaders(req) {
  const origin = req?.headers?.origin || '*';
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function checkAuth(req) {
  // Empty token only reachable with EVE_ALLOW_NO_TOKEN=1 (fail-closed at boot).
  if (!token) return true;
  const header = req.headers.authorization || '';
  return header === `Bearer ${token}`;
}

function sendJson(res, status, body, req) {
  res.writeHead(status, { 'content-type': 'application/json', ...corsHeaders(req) });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function sendBodyError(res, req, error) {
  if (error instanceof RequestBodyTooLargeError || error?.code === 'REQUEST_BODY_TOO_LARGE') {
    sendJson(res, 413, { error: 'payload_too_large' }, req);
    return true;
  }
  if (error instanceof BadJsonError || error?.code === 'BAD_JSON') {
    sendJson(res, 400, { error: 'bad_json' }, req);
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  // Preflight before auth — browsers omit Authorization on OPTIONS.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (!checkAuth(req)) {
    unauthorized(res, req);
    return;
  }

  const url = new URL(req.url || '/', `http://${HOST}`);
  const path = url.pathname.replace(/\/$/, '') || '/';

  try {
    if (req.method === 'GET' && (path === '/eve/v1' || path === '/eve/v1/')) {
      sendJson(
        res,
        200,
        {
          ok: true,
          modelReady,
          modelId: modelConfig.modelId,
          modelError: modelError || undefined,
          dataDir,
          booksRoot: booksRootEnv || undefined,
        },
        req,
      );
      return;
    }

    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain', ...corsHeaders(req) });
      res.end('ok');
      return;
    }

    if (req.method === 'GET' && path === '/eve/v1/skills') {
      if (!booksRootEnv) {
        sendJson(res, 503, { error: 'books_root_unset' }, req);
        return;
      }
      sendJson(res, 200, { skills: discoverSkills({ booksRoot: booksRootEnv }) }, req);
      return;
    }

    if (req.method === 'GET' && path === '/eve/v1/sessions') {
      const bookId = url.searchParams.get('bookId') || undefined;
      sendJson(res, 200, { sessions: sessions.list(bookId) }, req);
      return;
    }

    if (req.method === 'POST' && path === '/eve/v1/sessions') {
      const body = await readJson(req);
      if (!body.bookId || typeof body.bookId !== 'string') {
        sendJson(res, 400, { error: 'bookId_required' }, req);
        return;
      }
      const session = sessions.create({
        bookId: body.bookId,
        bookTitle: body.bookTitle,
        title: body.title,
      });
      sendJson(res, 201, session, req);
      return;
    }

    const sessionMatch = path.match(/^\/eve\/v1\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]);
      if (req.method === 'GET') {
        const session = sessions.get(id);
        if (!session) {
          sendJson(res, 404, { error: 'not_found' }, req);
          return;
        }
        sendJson(res, 200, session, req);
        return;
      }
      if (req.method === 'DELETE') {
        // Same mutex as POST /turns: deleting mid-turn would race with
        // sessions.save and resurrect the file after remove.
        if (!turnGate.tryAcquire(id)) {
          sendJson(res, 409, TURN_IN_FLIGHT_BODY, req);
          return;
        }
        try {
          if (!sessions.remove(id)) {
            sendJson(res, 404, { error: 'not_found' }, req);
            return;
          }
          res.writeHead(204, corsHeaders(req));
          res.end();
        } finally {
          turnGate.release(id);
        }
        return;
      }
    }

    const turnMatch = path.match(/^\/eve\/v1\/sessions\/([^/]+)\/turns$/);
    if (req.method === 'POST' && turnMatch) {
      const id = decodeURIComponent(turnMatch[1]);
      const session = sessions.get(id);
      if (!session) {
        sendJson(res, 404, { error: 'not_found' }, req);
        return;
      }
      if (!languageModel || !modelReady) {
        sendJson(res, 503, { error: 'model_not_ready', detail: modelError || 'missing apiKey' }, req);
        return;
      }
      if (!turnGate.tryAcquire(id)) {
        sendJson(res, 409, TURN_IN_FLIGHT_BODY, req);
        return;
      }
      try {
        const body = await readJson(req);
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!message) {
          sendJson(res, 400, { error: 'message_required' }, req);
          return;
        }
        const thinkingMode = normalizeThinkingMode(body.thinkingMode);

        res.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          ...corsHeaders(req),
        });

        // Client AbortController cancels the fetch; propagate into streamText.
        const { signal: abortSignal, settle: settleAbort } = createHttpAbort(req, res);

        const writeEvent = (event) => {
          if (res.writableEnded || res.destroyed) return;
          try {
            res.write(`${JSON.stringify(event)}\n`);
          } catch {
            // Client gone — abort path will stop the model/tools.
          }
        };

        try {
          await runTurn({
            model: languageModel,
            session,
            userMessage: message,
            getBooksRoot,
            onEvent: writeEvent,
            abortSignal,
            contextWindowTokens: modelContextWindowTokens,
            thinkingMode,
            persistSession: (s) => sessions.save(s),
          });
          sessions.save(session);
        } catch (error) {
          writeEvent({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
          // Persist rollbacks (e.g. compress-then-fail dropped the in-flight user).
          sessions.save(session);
        } finally {
          settleAbort();
        }
        if (!res.writableEnded) res.end();
      } finally {
        turnGate.release(id);
      }
      return;
    }

    sendJson(res, 404, { error: 'not_found' }, req);
  } catch (error) {
    if (sendBodyError(res, req, error)) return;
    sendJson(
      res,
      500,
      {
        error: 'internal',
        message: error instanceof Error ? error.message : String(error),
      },
      req,
    );
  }
});

const preferredPort = Number(process.env.PORT || process.env.NITRO_PORT || '0');
server.listen(preferredPort, HOST, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : preferredPort;
  console.log(`Listening http://${HOST}:${port}/`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
