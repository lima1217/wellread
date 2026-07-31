import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runTurn, consumeUIMessageStream } from './runTurn.mjs';

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
 * @param {Parameters<typeof runTurn>[0]} input
 */
async function run(input) {
  const chunks = await consumeUIMessageStream(runTurn(input));
  const assistant =
    input.session.messages.filter((m) => m.role === 'assistant').at(-1) ?? null;
  return { chunks, assistant };
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
    const ac = new AbortController();
    ac.abort();

    const { chunks, assistant } = await run({
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
      abortSignal: ac.signal,
    });

    assert.equal(assistant, null);
    assert.equal(session.messages.length, 0);
    assert.equal(
      chunks.some((c) => c.type === 'abort'),
      true,
    );
  });

  it('stops streaming and rolls back when abortSignal fires mid-turn', async () => {
    const session = emptySession();
    const ac = new AbortController();

    const { chunks, assistant } = await run({
      model: /** @type {any} */ (abortableModel(ac)),
      session,
      userMessage: 'keep going',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      abortSignal: ac.signal,
    });

    assert.equal(assistant, null);
    assert.equal(session.messages.length, 0);
    assert.equal(
      chunks.some((c) => c.type === 'abort'),
      true,
    );
    assert.equal(
      session.messages.some((m) => m.role === 'assistant'),
      false,
    );
  });

  it('rolls back the user message when the model returns an empty reply', async () => {
    const session = emptySession();

    const { chunks, assistant } = await run({
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
    });

    assert.equal(assistant, null);
    assert.equal(session.messages.length, 0);
    assert.equal(
      chunks.some(
        (c) => c.type === 'error' && /empty reply/i.test(String(c.errorText)),
      ),
      true,
    );
  });

  it('treats Stop (abort mid-connect) as aborted, not empty reply', async () => {
    const session = emptySession();
    const ac = new AbortController();

    const { chunks, assistant } = await run({
      model: /** @type {any} */ ({
        specificationVersion: 'v2',
        provider: 'test',
        modelId: 'abort-connect',
        supportedUrls: {},
        doGenerate: async () => {
          throw new Error('doGenerate unused');
        },
        doStream: async ({ abortSignal }) => {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 200);
            abortSignal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                const err = new Error('Aborted');
                err.name = 'AbortError';
                reject(err);
              },
              { once: true },
            );
            setTimeout(() => ac.abort(), 15);
          });
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.close();
              },
            }),
            rawCall: { rawPrompt: null, rawSettings: {} },
          };
        },
      }),
      session,
      userMessage: 'keep going',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      abortSignal: ac.signal,
    });

    assert.equal(assistant, null);
    assert.equal(session.messages.length, 0);
    assert.equal(
      chunks.some(
        (c) => c.type === 'error' && /empty reply/i.test(String(c.errorText)),
      ),
      false,
    );
    assert.equal(
      chunks.some((c) => c.type === 'abort'),
      true,
    );
  });

  it('surfaces provider stream errors instead of masking them as empty reply', async () => {
    const session = emptySession();

    const { chunks, assistant } = await run({
      model: /** @type {any} */ ({
        specificationVersion: 'v2',
        provider: 'test',
        modelId: 'provider-boom',
        supportedUrls: {},
        doGenerate: async () => {
          throw new Error('doGenerate unused');
        },
        doStream: async () => {
          throw new Error('provider exploded');
        },
      }),
      session,
      userMessage: 'say something',
      getBooksRoot: () => '/tmp/books-should-not-matter',
    });

    assert.equal(assistant, null);
    assert.equal(session.messages.length, 0);
    const errorChunk = chunks.find((c) => c.type === 'error');
    assert.ok(errorChunk, 'expected an error chunk');
    assert.match(String(errorChunk.errorText), /provider exploded/i);
    assert.equal(/empty reply/i.test(String(errorChunk.errorText)), false);
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
    /** @type {import('./sessionStore.mjs').Session[]} */
    const persisted = [];

    const { chunks } = await run({
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
      contextWindowTokens: 1000,
      generateTextFn: async () => ({ text: 'Compacted prior turns.' }),
      persistSession: (s) => {
        persisted.push({
          ...s,
          messages: s.messages.map((m) => ({ ...m })),
        });
      },
    });

    assert.equal(
      chunks.some((c) => c.type === 'data-eve-context-compressed'),
      true,
    );
    assert.equal(chunks.some((c) => c.type === 'error'), true);
    assert.ok(persisted.length >= 1);
    assert.equal(persisted[0].messages[0]?.compacted, true);
    const lastPersist = persisted[persisted.length - 1];
    assert.equal(lastPersist.messages.some((m) => m.content === 'after compress'), false);
    assert.equal(session.messages.some((m) => m.content === 'after compress'), false);
    assert.equal(session.messages[0]?.compacted, true);
  });
});
