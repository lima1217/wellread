#!/usr/bin/env node
/**
 * stdio ↔ Wellread MCP bridge. MCP clients (Claude Code, …) spawn this:
 *
 *   node mcpBridge.mjs --endpoint-file <EVE_DATA_DIR>/mcp-endpoint.json
 *
 * Reads newline-delimited JSON-RPC on stdin, forwards each message to the
 * running sidecar's POST /mcp (URL + token from the endpoint file, re-read per
 * message so sidecar restarts are invisible), and writes replies to stdout.
 * When Wellread is not running, requests get a JSON-RPC error saying so.
 * No dependencies: runs from the app bundle without NODE_PATH.
 */

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const NOT_RUNNING =
  'Wellread is not running. Open Wellread (and the book to read), then retry.';

/** @param {string[]} argv */
export function parseEndpointFileArg(argv, env = process.env) {
  const i = argv.indexOf('--endpoint-file');
  const fromArg = i >= 0 ? argv[i + 1] : undefined;
  return fromArg || env.WELLREAD_MCP_ENDPOINT_FILE || '';
}

/** @param {string} file */
function readEndpoint(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed?.url === 'string' && typeof parsed?.token === 'string') return parsed;
  } catch {
    // fall through
  }
  return null;
}

/**
 * Forward one JSON-RPC line; returns the reply text to write, or null.
 * @param {string} line
 * @param {{ endpointFile: string, fetchFn?: typeof fetch }} opts
 */
export async function forwardLine(line, opts) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    });
  }
  const ids = (Array.isArray(message) ? message : [message])
    .map((m) => m?.id)
    .filter((id) => id !== undefined && id !== null);
  const failAll = (/** @type {string} */ text) => {
    if (!ids.length) return null;
    const errors = ids.map((id) => ({ jsonrpc: '2.0', id, error: { code: -32000, message: text } }));
    return JSON.stringify(Array.isArray(message) ? errors : errors[0]);
  };

  const endpoint = readEndpoint(opts.endpointFile);
  if (!endpoint) return failAll(NOT_RUNNING);
  let res;
  try {
    res = await (opts.fetchFn ?? fetch)(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${endpoint.token}`,
      },
      body: line,
    });
  } catch {
    return failAll(NOT_RUNNING);
  }
  if (res.status === 202) return null;
  const body = await res.text();
  if (!res.ok) return failAll(`Wellread MCP error ${res.status}: ${body.slice(0, 200)}`);
  return body.trim() || null;
}

async function main() {
  const endpointFile = parseEndpointFileArg(process.argv.slice(2));
  if (!endpointFile) {
    console.error('usage: mcpBridge.mjs --endpoint-file <path to mcp-endpoint.json>');
    process.exit(2);
  }
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  /** @type {Set<Promise<void>>} */
  const inflight = new Set();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const p = forwardLine(line, { endpointFile })
      .then((reply) => {
        if (reply) process.stdout.write(`${reply}\n`);
      })
      .catch((error) => console.error('[wellread-mcp]', error))
      .finally(() => inflight.delete(p));
    inflight.add(p);
  });
  rl.on('close', async () => {
    await Promise.all(inflight);
    process.exit(0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
