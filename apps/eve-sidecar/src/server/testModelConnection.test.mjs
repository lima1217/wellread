import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { testModelConnection } from './testModelConnection.mjs';

/** @type {typeof fetch} */
function jsonFetch(url, init, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.onSignal) options.onSignal(init?.signal);
    if (options.neverResolve) return;
    if (options.rejectWith) {
      reject(options.rejectWith);
      return;
    }
    resolve(
      new Response(JSON.stringify(options.body ?? { data: [] }), {
        status: options.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

describe('testModelConnection', () => {
  it('fails fast without an apiKey', async () => {
    const result = await testModelConnection({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: '   ',
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /api key/i);
  });

  it('fails without a baseURL', async () => {
    const result = await testModelConnection({ apiKey: 'sk-test' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /base url/i);
  });

  it('GETs /models on the user baseURL with the apiKey', async () => {
    /** @type {string | undefined} */
    let seenUrl;
    /** @type {Record<string, unknown> | undefined} */
    let seenInit;
    const baseFetch = async (url, init) => {
      seenUrl = String(url);
      seenInit = init;
      return jsonFetch(url, init);
    };
    const result = await testModelConnection({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      baseFetch,
    });
    assert.equal(result.ok, true);
    assert.equal(seenUrl, 'https://api.deepseek.com/v1/models');
    assert.equal(
      /** @type {Headers} */ (new Headers(seenInit?.headers)).get('authorization'),
      'Bearer sk-test',
    );
  });

  it('strips trailing slashes from the baseURL', async () => {
    /** @type {string | undefined} */
    let seenUrl;
    const baseFetch = async (url, init) => {
      seenUrl = String(url);
      return jsonFetch(url, init);
    };
    await testModelConnection({
      baseURL: 'https://opencode.ai/zen/go/v1/',
      apiKey: 'sk-test',
      baseFetch,
    });
    assert.equal(seenUrl, 'https://opencode.ai/zen/go/v1/models');
  });

  it('reports upstream HTTP errors with the status', async () => {
    const result = await testModelConnection({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'bad',
      baseFetch: (url, init) => jsonFetch(url, init, { status: 401 }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /401/);
  });

  it('surfaces network errors', async () => {
    const result = await testModelConnection({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      baseFetch: (url, init) => jsonFetch(url, init, { rejectWith: new Error('getaddrinfo ENOTFOUND') }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /ENOTFOUND/);
  });

  it('times out instead of hanging forever', async () => {
    const result = await testModelConnection({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      timeoutMs: 20,
      baseFetch: (url, init) =>
        jsonFetch(url, init, {
          neverResolve: true,
          onSignal: (signal) => {
            signal?.addEventListener('abort', () => {
              // Real fetch rejects on abort; emulate it.
            });
          },
        }),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /timed out/i);
  });
});
