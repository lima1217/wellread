/**
 * wellread eve sidecar — loopback HTTP server.
 *
 * Speaks the 05/10 handshake: listen on 127.0.0.1 with PORT=0, print a
 * `Listening http://127.0.0.1:<port>/` line, require Bearer loopback token,
 * expose GET /eve/v1 for readiness. Durable state under EVE_DATA_DIR.
 */

import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { createOpenAI } from '@ai-sdk/openai';
import { createLanguageModel, normalizeModelEnv } from './createModel.mjs';

const HOST = '127.0.0.1';
const token = (process.env.EVE_LOOPBACK_TOKEN || '').trim();
const dataDir = process.env.EVE_DATA_DIR || './.eve-data';

mkdirSync(dataDir, { recursive: true });

const modelConfig = normalizeModelEnv({
  baseURL: process.env.EVE_MODEL_BASE_URL,
  apiKey: process.env.EVE_MODEL_API_KEY,
  modelId: process.env.EVE_MODEL_ID,
  contextWindowTokens: process.env.EVE_MODEL_CONTEXT_WINDOW,
});

let modelReady = false;
let modelError = '';
try {
  createLanguageModel(modelConfig, { createOpenAI });
  modelReady = Boolean(modelConfig.apiKey);
} catch (error) {
  modelError = error instanceof Error ? error.message : String(error);
}

function unauthorized(res) {
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

function checkAuth(req) {
  if (!token) return true;
  const header = req.headers.authorization || '';
  return header === `Bearer ${token}`;
}

const server = http.createServer((req, res) => {
  if (!checkAuth(req)) {
    unauthorized(res);
    return;
  }

  const url = new URL(req.url || '/', `http://${HOST}`);

  if (req.method === 'GET' && (url.pathname === '/eve/v1' || url.pathname === '/eve/v1/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        modelReady,
        modelId: modelConfig.modelId,
        modelError: modelError || undefined,
        dataDir,
      }),
    );
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
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
