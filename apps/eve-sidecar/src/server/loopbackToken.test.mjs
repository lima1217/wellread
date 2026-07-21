import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveLoopbackToken } from './loopbackToken.mjs';

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
