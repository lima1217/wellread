import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodeEveSideChunk,
  encodeEveSideChunk,
  EVE_CONTEXT_COMPRESSED_CHUNK,
  EVE_CONTEXT_COMPRESS_FAILED_CHUNK,
} from './sideEvents.mjs';

describe('encodeEveSideChunk / decodeEveSideChunk', () => {
  it('round-trips context.compressed', () => {
    const event = {
      type: 'context.compressed',
      beforeTokens: 1000,
      afterTokens: 400,
      targetTokens: 500,
      removedIds: ['m1', 'm2'],
      summary: {
        id: 'sum1',
        role: 'assistant',
        content: 'earlier turns…',
        createdAt: 1,
        compacted: true,
      },
    };
    const chunk = encodeEveSideChunk(event);
    assert.equal(chunk.type, EVE_CONTEXT_COMPRESSED_CHUNK);
    assert.deepEqual(decodeEveSideChunk(chunk), event);
  });

  it('round-trips context.compress_failed', () => {
    const event = { type: 'context.compress_failed', message: 'budget blow' };
    const chunk = encodeEveSideChunk(event);
    assert.equal(chunk.type, EVE_CONTEXT_COMPRESS_FAILED_CHUNK);
    assert.deepEqual(decodeEveSideChunk(chunk), event);
  });

  it('decodes error and abort chunks', () => {
    assert.deepEqual(decodeEveSideChunk({ type: 'error', errorText: 'boom' }), {
      type: 'error',
      message: 'boom',
    });
    assert.deepEqual(decodeEveSideChunk({ type: 'abort', reason: 'client' }), {
      type: 'abort',
      reason: 'client',
    });
  });

  it('ignores ordinary UIMessage chunks and unknown events', () => {
    assert.equal(decodeEveSideChunk({ type: 'text-delta', delta: 'hi' }), null);
    assert.equal(encodeEveSideChunk({ type: 'ui-message' }), null);
  });

  it('does not forward extra properties on context.compressed', () => {
    const chunk = encodeEveSideChunk({
      type: 'context.compressed',
      beforeTokens: 1,
      afterTokens: 2,
      targetTokens: 3,
      removedIds: [],
      summary: { id: 's', role: 'assistant', content: 'x', createdAt: 0 },
      secret: 'nope',
    });
    assert.equal('secret' in chunk.data, false);
    assert.deepEqual(Object.keys(chunk.data).sort(), [
      'afterTokens',
      'beforeTokens',
      'removedIds',
      'summary',
      'targetTokens',
    ]);
  });
});
