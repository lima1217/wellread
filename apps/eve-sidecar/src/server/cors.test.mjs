import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_ALLOWED_ORIGINS,
  buildAllowedOriginSet,
  corsHeaders,
  isAllowedCorsOrigin,
  parseCorsOriginsEnv,
} from './cors.mjs';

describe('parseCorsOriginsEnv', () => {
  it('splits comma-separated origins and trims', () => {
    assert.deepEqual(parseCorsOriginsEnv(' http://a.test ,https://b.test '), [
      'http://a.test',
      'https://b.test',
    ]);
  });

  it('returns [] for blank input', () => {
    assert.deepEqual(parseCorsOriginsEnv(''), []);
    assert.deepEqual(parseCorsOriginsEnv('   '), []);
    assert.deepEqual(parseCorsOriginsEnv(undefined), []);
  });
});

describe('isAllowedCorsOrigin', () => {
  const allowed = buildAllowedOriginSet(['http://extra.test']);

  it('accepts defaults and extras', () => {
    assert.equal(isAllowedCorsOrigin('http://localhost:3000', allowed), true);
    assert.equal(isAllowedCorsOrigin('http://tauri.localhost', allowed), true);
    assert.equal(isAllowedCorsOrigin('http://extra.test', allowed), true);
  });

  it('rejects unknown and empty', () => {
    assert.equal(isAllowedCorsOrigin('https://evil.example', allowed), false);
    assert.equal(isAllowedCorsOrigin('', allowed), false);
    assert.equal(isAllowedCorsOrigin(undefined, allowed), false);
  });
});

describe('corsHeaders', () => {
  it('reflects only allowlisted Origin', () => {
    const headers = corsHeaders({ headers: { origin: 'http://localhost:3000' } });
    assert.equal(headers['access-control-allow-origin'], 'http://localhost:3000');
    assert.equal(headers.vary, 'Origin');
    assert.match(headers['access-control-allow-headers'], /authorization/i);
  });

  it('omits ACAO for unknown Origin (does not reflect)', () => {
    const headers = corsHeaders({ headers: { origin: 'https://evil.example' } });
    assert.equal(headers['access-control-allow-origin'], undefined);
  });

  it('omits ACAO when Origin is absent (curl / plugin-http)', () => {
    const headers = corsHeaders({ headers: {} });
    assert.equal(headers['access-control-allow-origin'], undefined);
  });

  it('never falls back to *', () => {
    const headers = corsHeaders({ headers: { origin: 'https://evil.example' } });
    assert.notEqual(headers['access-control-allow-origin'], '*');
  });

  it('honors extra origins from the allowed set', () => {
    const allowedOrigins = buildAllowedOriginSet(['http://127.0.0.1:4173']);
    const headers = corsHeaders(
      { headers: { origin: 'http://127.0.0.1:4173' } },
      { allowedOrigins },
    );
    assert.equal(headers['access-control-allow-origin'], 'http://127.0.0.1:4173');
  });

  it('keeps a stable default allowlist for wellread webviews', () => {
    assert.ok(DEFAULT_ALLOWED_ORIGINS.includes('http://localhost:3000'));
    assert.ok(DEFAULT_ALLOWED_ORIGINS.includes('http://tauri.localhost'));
  });
});
