import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import {
  BadJsonError,
  MAX_JSON_BODY_BYTES,
  RequestBodyTooLargeError,
  readJson,
} from './readJson.mjs';

function reqFrom(chunks) {
  return Readable.from(chunks);
}

describe('readJson', () => {
  it('parses a normal JSON body', async () => {
    const body = await readJson(reqFrom([Buffer.from('{"a":1}')]));
    assert.deepEqual(body, { a: 1 });
  });

  it('returns {} for an empty body', async () => {
    assert.deepEqual(await readJson(reqFrom([])), {});
  });

  it('throws BadJsonError for malformed JSON', async () => {
    await assert.rejects(
      () => readJson(reqFrom([Buffer.from('{not-json')])),
      (err) => err instanceof BadJsonError && err.code === 'BAD_JSON',
    );
  });

  it('throws RequestBodyTooLargeError above the byte cap', async () => {
    const oversized = Buffer.alloc(MAX_JSON_BODY_BYTES + 1, 0x61);
    await assert.rejects(
      () => readJson(reqFrom([oversized])),
      (err) =>
        err instanceof RequestBodyTooLargeError &&
        err.code === 'REQUEST_BODY_TOO_LARGE',
    );
  });
});
