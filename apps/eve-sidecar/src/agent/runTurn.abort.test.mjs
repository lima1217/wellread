import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runTurn } from './runTurn.mjs';

/**
 * @returns {import('./sessionStore.mjs').Session}
 */
function emptySession() {
  return {
    id: 'sess_test',
    bookId: 'book_1',
    bookTitle: 'Test Book',
    title: 'Chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

/**
 * Minimal LanguageModelV2 that streams one delta then waits until aborted.
 * @param {AbortController} ac
 */
function abortableModel(ac) {
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'abort-test',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('doGenerate unused');
    },
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: 't1' });
          controller.enqueue({ type: 'text-delta', id: 't1', delta: 'partial ' });

          const fail = () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            try {
              controller.error(err);
            } catch {
              // already closed
            }
          };

          if (abortSignal?.aborted) {
            fail();
            return;
          }
          abortSignal?.addEventListener('abort', fail, { once: true });
          setTimeout(() => ac.abort(), 20);
        },
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  };
}

describe('runTurn abort', () => {
  it('rolls back the user message when abortSignal is already aborted', async () => {
    const session = emptySession();
    const events = [];
    const ac = new AbortController();
    ac.abort();

    const result = await runTurn({
      model: /** @type {any} */ ({
        specificationVersion: 'v2',
        provider: 'test',
        modelId: 'unused',
        doStream: async () => {
          throw new Error('model should not be called when already aborted');
        },
      }),
      session,
      userMessage: 'explain this',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      onEvent: (event) => events.push(event),
      abortSignal: ac.signal,
    });

    assert.equal(result, null);
    assert.equal(session.messages.length, 0);
    assert.equal(events.some((e) => e.type === 'message.user'), true);
    assert.deepEqual(
      events.filter((e) => e.type === 'done'),
      [{ type: 'done', aborted: true }],
    );
  });

  it('stops streaming and rolls back when abortSignal fires mid-turn', async () => {
    const session = emptySession();
    const events = [];
    const ac = new AbortController();

    const result = await runTurn({
      model: /** @type {any} */ (abortableModel(ac)),
      session,
      userMessage: 'keep going',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      onEvent: (event) => events.push(event),
      abortSignal: ac.signal,
    });

    assert.equal(result, null);
    assert.equal(session.messages.length, 0);
    assert.equal(events.at(-1)?.type, 'done');
    assert.equal(events.at(-1)?.aborted, true);
    assert.equal(events.some((e) => e.type === 'message.assistant'), false);
  });
});
