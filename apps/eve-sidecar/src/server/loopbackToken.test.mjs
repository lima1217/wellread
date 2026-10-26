import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveLoopbackToken, tokenMatches } from './loopbackToken.mjs';
import { readStdinSecret } from './stdinSecret.mjs';

const serverEntry = join(dirname(fileURLToPath(import.meta.url)), 'index.mjs');

describe('resolveLoopbackToken', () => {
  it('accepts a non-empty token', () => {
    assert.deepEqual(resolveLoopbackToken({ EVE_LOOPBACK_TOKEN: ' secret ' }), {
      ok: true,
      token: 'secret',
    });
  });

  it('fails closed when token is missing', () => {
    const result = resolveLoopbackToken({});
    assert.equal(result.ok, false);
    assert.match(result.reason, /EVE_LOOPBACK_TOKEN/);
  });

  it('fails closed when token is blank', () => {
    const result = resolveLoopbackToken({ EVE_LOOPBACK_TOKEN: '   ' });
    assert.equal(result.ok, false);
  });

  it('allows empty token only with EVE_ALLOW_NO_TOKEN=1', () => {
    assert.deepEqual(
      resolveLoopbackToken({ EVE_ALLOW_NO_TOKEN: '1' }),
      { ok: true, token: '' },
    );
  });
});

describe('tokenMatches', () => {
  it('accepts only the exact Bearer header', () => {
    assert.equal(tokenMatches('Bearer secret', 'secret'), true);
    assert.equal(tokenMatches('Bearer secreT', 'secret'), false);
    assert.equal(tokenMatches('Bearer secret2', 'secret'), false);
    assert.equal(tokenMatches('secret', 'secret'), false);
    assert.equal(tokenMatches(undefined, 'secret'), false);
  });
});

describe('readStdinSecret', () => {
  it('joins chunks and trims the trailing newline', async () => {
    assert.equal(await readStdinSecret(['sk-', Buffer.from('abc\n')]), 'sk-abc');
  });

  it('rejects oversized input', async () => {
    await assert.rejects(readStdinSecret(['x'.repeat(70 * 1024)]), /too large/);
  });
});

describe('sidecar boot fail-closed', () => {
  it('exits non-zero without EVE_LOOPBACK_TOKEN', async () => {
    const env = { ...process.env };
    delete env.EVE_LOOPBACK_TOKEN;
    delete env.EVE_ALLOW_NO_TOKEN;
    const child = spawn(process.execPath, [serverEntry], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result = await new Promise((resolve, reject) => {
      let buf = '';
      child.stderr.on('data', (c) => {
        buf += c.toString();
      });
      child.stdout.on('data', (c) => {
        buf += c.toString();
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        resolve({ code, buf });
      });
    });
    assert.notEqual(result.code, 0);
    assert.match(result.buf, /EVE_LOOPBACK_TOKEN/);
  });
});

describe('sidecar boot with stdin API key', () => {
  it('reads the key from stdin and reports modelReady', async () => {
    const env = { ...process.env, EVE_LOOPBACK_TOKEN: 'tok', EVE_MODEL_API_KEY_STDIN: '1' };
    delete env.EVE_MODEL_API_KEY;
    const child = spawn(process.execPath, [serverEntry], {
      env,
      cwd: mkdtempSync(join(tmpdir(), 'eve-stdin-')),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      child.stdin.end('sk-from-stdin\n');
      const url = await new Promise((resolve, reject) => {
        let buf = '';
        child.stdout.on('data', (c) => {
          buf += c.toString();
          const m = buf.match(/Listening (http:\/\/\S+)/);
          if (m) resolve(m[1]);
        });
        child.on('error', reject);
        child.on('exit', (code) => reject(new Error(`exited ${code}`)));
      });
      const res = await fetch(`${url}eve/v1`, { headers: { authorization: 'Bearer tok' } });
      const body = await res.json();
      assert.equal(body.modelReady, true);
    } finally {
      child.kill();
    }
  });
});
