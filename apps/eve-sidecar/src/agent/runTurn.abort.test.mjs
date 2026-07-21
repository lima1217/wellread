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

  it('rolls back the user message when the model returns an empty reply', async () => {
    const session = emptySession();
    const events = [];

    const result = await runTurn({
      model: /** @type {any} */ ({
        specificationVersion: 'v2',
        provider: 'test',
        modelId: 'empty-test',
        supportedUrls: {},
        doGenerate: async () => {
          throw new Error('doGenerate unused');
        },
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({ type: 'text-start', id: 't1' });
              controller.enqueue({ type: 'text-end', id: 't1' });
              controller.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
              });
              controller.close();
            },
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        }),
      }),
      session,
      userMessage: 'say something',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      onEvent: (event) => events.push(event),
    });

    assert.equal(result, null);
    assert.equal(session.messages.length, 0);
    assert.equal(
      events.some((e) => e.type === 'error' && /empty reply/i.test(String(e.message))),
      true,
    );
    assert.deepEqual(
      events.filter((e) => e.type === 'done'),
      [{ type: 'done' }],
    );
  });

  it('persists the session after compress even when the turn later fails', async () => {
    const messages = [];
    for (let i = 0; i < 20; i++) {
      messages.push({
        id: `m_${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'x'.repeat(200),
        createdAt: i,
      });
    }
    const session = {
      ...emptySession(),
      messages,
    };
    const events = [];
    /** @type {import('./sessionStore.mjs').Session[]} */
    const persisted = [];

    const result = await runTurn({
      model: /** @type {any} */ ({
        specificationVersion: 'v2',
        provider: 'test',
        modelId: 'fail-after-compress',
        supportedUrls: {},
        doGenerate: async () => {
          throw new Error('doGenerate unused');
        },
        doStream: async () => {
          throw new Error('stream boom');
        },
      }),
      session,
      userMessage: 'after compress',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      onEvent: (event) => events.push(event),
      contextWindowTokens: 1000,
      generateTextFn: async () => ({ text: 'Compacted prior turns.' }),
      persistSession: (s) => {
        persisted.push({
          ...s,
          messages: s.messages.map((m) => ({ ...m })),
        });
      },
    });

    assert.equal(result, null);
    assert.equal(events.some((e) => e.type === 'context.compressed'), true);
    assert.equal(events.some((e) => e.type === 'error'), true);
    assert.ok(persisted.length >= 1);
    assert.equal(persisted[0].messages[0]?.compacted, true);
    // Final persist after rollback must not keep the unanswered user.
    const lastPersist = persisted[persisted.length - 1];
    assert.equal(lastPersist.messages.some((m) => m.content === 'after compress'), false);
    // Failed turn must not leave an unanswered user message.
    assert.equal(session.messages.some((m) => m.content === 'after compress'), false);
    assert.equal(session.messages[0]?.compacted, true);
  });
});
