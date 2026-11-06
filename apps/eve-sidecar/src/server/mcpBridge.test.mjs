import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { forwardLine, parseEndpointFileArg } from './mcpBridge.mjs';
import { mcpBridgeCommand, removeMcpEndpoint, writeMcpEndpoint } from './mcpEndpoint.mjs';

const ping = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' });

describe('MCP stdio bridge', () => {
  it('forwards a line to the endpoint from the file with its token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eve-mcp-bridge-'));
    try {
      writeMcpEndpoint(dir, { url: 'http://127.0.0.1:1/mcp', token: 'tok' });
      /** @type {{ url: string, init: RequestInit } | null} */
      let seen = null;
      const reply = await forwardLine(ping, {
        endpointFile: join(dir, 'mcp-endpoint.json'),
        fetchFn: async (url, init) => {
          seen = { url: String(url), init };
          return new Response('{"jsonrpc":"2.0","id":7,"result":{}}\n', { status: 200 });
        },
      });
      assert.equal(reply, '{"jsonrpc":"2.0","id":7,"result":{}}');
      assert.equal(seen?.url, 'http://127.0.0.1:1/mcp');
      assert.equal(seen?.init.headers.authorization, 'Bearer tok');
      assert.equal(seen?.init.body, ping);

      const accepted = await forwardLine('{"jsonrpc":"2.0","method":"notifications/initialized"}', {
        endpointFile: join(dir, 'mcp-endpoint.json'),
        fetchFn: async () => new Response(null, { status: 202 }),
      });
      assert.equal(accepted, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers requests with a "not running" error when Wellread is closed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eve-mcp-bridge-'));
    try {
      const missing = JSON.parse(await forwardLine(ping, { endpointFile: join(dir, 'none.json') }));
      assert.equal(missing.id, 7);
      assert.match(missing.error.message, /Wellread is not running/);

      writeMcpEndpoint(dir, { url: 'http://127.0.0.1:1/mcp', token: 'tok' });
      const refused = JSON.parse(
        await forwardLine(ping, {
          endpointFile: join(dir, 'mcp-endpoint.json'),
          fetchFn: async () => {
            throw new TypeError('fetch failed');
          },
        }),
      );
      assert.match(refused.error.message, /Wellread is not running/);

      // Notifications get no reply even when the app is closed.
      assert.equal(
        await forwardLine('{"jsonrpc":"2.0","method":"notifications/initialized"}', {
          endpointFile: join(dir, 'none.json'),
        }),
        null,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes the endpoint file only for the process that wrote it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eve-mcp-bridge-'));
    try {
      const file = join(dir, 'mcp-endpoint.json');
      writeFileSync(file, JSON.stringify({ url: 'u', token: 't', pid: -1 }));
      removeMcpEndpoint(dir);
      assert.doesNotThrow(() => readFileSync(file, 'utf8'));
      writeMcpEndpoint(dir, { url: 'u', token: 't' });
      removeMcpEndpoint(dir);
      assert.throws(() => readFileSync(file, 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds the client command from this runtime and the endpoint file', () => {
    const { command, args } = mcpBridgeCommand('/data/eve');
    assert.equal(command, process.execPath);
    assert.match(args[0], /mcpBridge\.mjs$/);
    assert.deepEqual(args.slice(1), ['--endpoint-file', '/data/eve/mcp-endpoint.json']);
    assert.equal(parseEndpointFileArg(args.slice(1), {}), '/data/eve/mcp-endpoint.json');
    assert.equal(parseEndpointFileArg([], { WELLREAD_MCP_ENDPOINT_FILE: '/x.json' }), '/x.json');
  });
});
