/**
 * wellread eve sidecar — loopback HTTP server (Reading Assistant v1).
 *
 * Speaks the 05/10 handshake: listen on 127.0.0.1 with PORT=0, print a
 * `Listening http://127.0.0.1:<port>/` line, require Bearer loopback token,
 * expose GET /eve/v1 for readiness + session/chat APIs under /eve/v1/*.
 * CORS is an Origin allowlist (see cors.mjs / README) — never reflect `*`.
 */

import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { createOpenAI } from '@ai-sdk/openai';
import { pipeUIMessageStreamToResponse } from 'ai';
import {
  createLanguageModel,
  normalizeModelEnv,
  normalizeThinkingMode,
} from '../createModel.mjs';
import { createHttpAbort } from '../agent/httpAbort.mjs';
import {
  createSessionStore,
  isSafeSessionId,
} from '../agent/sessionStore.mjs';
import { isSafeBookIdSegment } from '../agent/notesOkf.mjs';
import { normalizeReaderState } from '../agent/prompt.mjs';
import { runTurn } from '../agent/runTurn.mjs';
import { discoverSkills } from '../agent/skills/discover.mjs';
import {
  buildAllowedOriginSet,
  corsHeaders as buildCorsHeaders,
  parseCorsOriginsEnv,
} from './cors.mjs';
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
import { testModelConnection } from './testModelConnection.mjs';
import { waitForResponseEnd } from './waitForResponseEnd.mjs';

const HOST = '127.0.0.1';

/** decodeURIComponent that returns null on malformed % sequences (no 500). */
function decodePathParam(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

const tokenResult = resolveLoopbackToken(process.env);
if (!tokenResult.ok) {
  console.error(tokenResult.reason);
  process.exit(1);
}
const token = tokenResult.token;
const allowedOrigins = buildAllowedOriginSet(
  parseCorsOriginsEnv(process.env.EVE_CORS_ORIGINS),
);

const dataDir = process.env.EVE_DATA_DIR || './.eve-data';
const booksRootEnv = (process.env.EVE_BOOKS_ROOT || '').trim();

mkdirSync(dataDir, { recursive: true });

/** In-flight turn cancel handles per session — lets Stop release the turn gate
 * without waiting for the client's socket close to propagate (plugin-http
 * defers the close until the next SSE chunk, which can lag far behind Stop). */
const turnAborters = new Map();

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
  return buildCorsHeaders(req, { allowedOrigins });
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
      const includeDisabled =
        url.searchParams.get('includeDisabled') === '1' ||
        url.searchParams.get('includeDisabled') === 'true';
      sendJson(
        res,
        200,
        { skills: discoverSkills({ booksRoot: booksRootEnv, includeDisabled }) },
        req,
      );
      return;
    }

    if (req.method === 'POST' && path === '/eve/v1/test-model-connection') {
      const body = await readJson(req);
      const result = await testModelConnection({
        baseURL: typeof body.baseURL === 'string' ? body.baseURL : '',
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : '',
        apiMode: typeof body.apiMode === 'string' ? body.apiMode : undefined,
      });
      sendJson(res, 200, result, req);
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
      if (!isSafeBookIdSegment(body.bookId)) {
        sendJson(res, 400, { error: 'bookId_invalid' }, req);
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
      const id = decodePathParam(sessionMatch[1]);
      if (!id || !isSafeSessionId(id)) {
        sendJson(res, 400, { error: 'session_id_invalid' }, req);
        return;
      }
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
    const turnCancelMatch = path.match(/^\/eve\/v1\/sessions\/([^/]+)\/turns\/cancel$/);
    if (req.method === 'POST' && turnCancelMatch) {
      const id = decodePathParam(turnCancelMatch[1]);
      if (!id || !isSafeSessionId(id)) {
        sendJson(res, 400, { error: 'session_id_invalid' }, req);
        return;
      }
      turnAborters.get(id)?.();
      sendJson(res, 200, { ok: true }, req);
      return;
    }
    if (req.method === 'POST' && turnMatch) {
      const id = decodePathParam(turnMatch[1]);
      if (!id || !isSafeSessionId(id)) {
        sendJson(res, 400, { error: 'session_id_invalid' }, req);
        return;
      }
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
        if (process.env.EVE_GATE_LOG === '1') {
          console.error(`[gate] 409 turn_in_flight for ${id}`);
        }
        sendJson(res, 409, TURN_IN_FLIGHT_BODY, req);
        return;
      }
      const turnStartMs = Date.now();
      if (process.env.EVE_GATE_LOG === '1') {
        console.error(`[gate] turn acquired ${id}`);
      }
      try {
        const body = await readJson(req);
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!message) {
          sendJson(res, 400, { error: 'message_required' }, req);
          return;
        }
        const thinkingMode = normalizeThinkingMode(body.thinkingMode);
        const readerState = normalizeReaderState(body.readerState);

        // Client AbortController cancels the fetch; propagate into streamText.
        const { signal: abortSignal, settle: settleAbort, cancel: cancelTurn } =
          createHttpAbort(req, res);
        turnAborters.set(id, cancelTurn);

        try {
          const stream = runTurn({
            model: languageModel,
            session,
            userMessage: message,
            getBooksRoot,
            abortSignal,
            contextWindowTokens: modelContextWindowTokens,
            thinkingMode,
            apiMode: modelConfig.apiMode,
            baseURL: modelConfig.baseURL,
            readerState,
            // runTurn owns mid-turn + onFinish persistence via this callback.
            persistSession: (s) => sessions.save(s),
          });
          pipeUIMessageStreamToResponse({
            response: res,
            stream,
            headers: corsHeaders(req),
          });
          // Hold the turn gate until the response ends AND onFinish persist/
          // dropUser settles — releasing on HTTP close alone races abort cleanup.
          // Cap finished wait so a missing/hung onFinish cannot pin turnGate forever
          // (waitForResponseEnd already has its own backstop).
          await waitForResponseEnd(res);
          if (process.env.EVE_GATE_LOG === '1') {
            console.error(
              `[gate] response ended for ${id} writableEnded=${res.writableEnded} destroyed=${res.destroyed} after ${Date.now() - turnStartMs}ms`,
            );
          }
          const FINISHED_BACKSTOP_MS = 60_000;
          await Promise.race([
            Promise.resolve(stream.finished).catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, FINISHED_BACKSTOP_MS)),
          ]);
          if (process.env.EVE_GATE_LOG === '1') {
            console.error(`[gate] finished settled for ${id} after ${Date.now() - turnStartMs}ms`);
          }
          // No success-path re-save: onFinish / compress / dropUser already
          // persisted through persistSession.
        } catch (error) {
          if (!res.headersSent) {
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
          // Crash belt when the stream throws before onFinish — only if the
          // session still looks like a valid container.
          try {
            sessions.save(session);
          } catch {
            // ignore corrupt in-memory session
          }
        } finally {
          settleAbort();
        }
      } finally {
        turnAborters.delete(id);
        turnGate.release(id);
        if (process.env.EVE_GATE_LOG === '1') {
          console.error(`[gate] turn released ${id} after ${Date.now() - turnStartMs}ms`);
        }
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

// Keep the loopback server alive if a turn's UI-message transform throws
// (historically: AI SDK reasoning after finish-step). One bad turn must not
// leave the app pointing at a dead PORT.
process.on('uncaughtException', (err) => {
  console.error('[eve-sidecar] uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[eve-sidecar] unhandledRejection', reason);
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
