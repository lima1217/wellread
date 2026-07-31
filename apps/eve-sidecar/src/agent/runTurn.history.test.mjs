import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import { runTurn } from './runTurn.mjs';

function emptySession() {
  return {
    id: 'sess_hist',
    bookId: 'book_1',
    bookTitle: 'Test Book',
    title: 'Chat about Test Book',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

function answerModel(text = 'done') {
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'hist',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('doGenerate unused');
    },
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: 't1' });
          controller.enqueue({ type: 'text-delta', id: 't1', delta: text });
          controller.enqueue({ type: 'text-end', id: 't1' });
          controller.enqueue({
            type: 'finish',
            finishReason: 'stop',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          });
          controller.close();
        },
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  };
}

function capturePromptModel(sink, text = 'ok') {
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'hist-capture',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('doGenerate unused');
    },
    doStream: async ({ prompt }) => {
      sink.prompt = prompt;
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't1' });
            controller.enqueue({ type: 'text-delta', id: 't1', delta: text });
            controller.enqueue({ type: 'text-end', id: 't1' });
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            });
            controller.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

describe('runTurn model history', () => {
  it('persists modelMessages from the SDK response when available', async () => {
    const session = emptySession();
    const result = await runTurn({
      model: /** @type {any} */ (answerModel('hello')),
      session,
      userMessage: 'hi',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools: {},
      onEvent: () => {},
      generateTextFn: async () => ({ text: '', usage: {} }),
    });
    assert.ok(result);
    const assistant = session.messages.at(-1);
    assert.equal(assistant?.role, 'assistant');
    assert.equal(assistant?.content, 'hello');
    assert.deepEqual(assistant?.modelMessages, [
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ]);
  });

  it('resends prior tool call/result parts on the next turn', async () => {
    const session = emptySession();
    session.messages.push({
      id: 'u1',
      role: 'user',
      content: 'find whale',
      createdAt: Date.now(),
    });
    session.messages.push({
      id: 'a1',
      role: 'assistant',
      content: 'Found it.',
      createdAt: Date.now(),
      reasoning: 'search extract',
      tools: [
        {
          id: 'tc_read',
          name: 'read_file',
          args: { path: '/workspace/.wellread/extract/book_1/a.md' },
          result: { ok: true, text: 'whale' },
        },
      ],
    });

    const sink = {};
    await runTurn({
      model: /** @type {any} */ (capturePromptModel(sink)),
      session,
      userMessage: 'quote it',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools: {
        read_file: tool({
          description: 'read',
          inputSchema: z.object({ path: z.string() }),
          execute: async () => ({ ok: true }),
        }),
      },
      onEvent: () => {},
      generateTextFn: async () => ({ text: '', usage: {} }),
    });

    assert.ok(Array.isArray(sink.prompt));
    const roles = sink.prompt.map((p) => p?.role);
    assert.ok(roles.includes('tool'), `expected tool role in prompt, got ${roles.join(',')}`);
    const assistantWithTools = sink.prompt.find(
      (p) =>
        p?.role === 'assistant' &&
        Array.isArray(p.content) &&
        p.content.some((c) => c?.type === 'tool-call'),
    );
    assert.ok(assistantWithTools, 'expected assistant tool-call parts in history');
    const reasoning = sink.prompt.find(
      (p) =>
        p?.role === 'assistant' &&
        Array.isArray(p.content) &&
        p.content.some((c) => c?.type === 'reasoning'),
    );
    assert.ok(reasoning, 'expected reasoning part in history');
  });

  it('passes store:false instructions via providerOptions in responses mode', async () => {
    const sink = {};
    const model = {
      specificationVersion: 'v2',
      provider: 'test',
      modelId: 'resp',
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error('doGenerate unused');
      },
      doStream: async (opts) => {
        sink.opts = opts;
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({ type: 'text-start', id: 't1' });
              controller.enqueue({ type: 'text-delta', id: 't1', delta: 'ok' });
              controller.enqueue({ type: 'text-end', id: 't1' });
              controller.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              });
              controller.close();
            },
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      },
    };

    await runTurn({
      model: /** @type {any} */ (model),
      session: emptySession(),
      userMessage: 'hi',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools: {},
      apiMode: 'responses',
      thinkingMode: 'think',
      onEvent: () => {},
      generateTextFn: async () => ({ text: '', usage: {} }),
    });

    assert.equal(sink.opts?.providerOptions?.openai?.store, false);
    assert.equal(sink.opts?.providerOptions?.openai?.reasoningEffort, 'high');
    assert.match(String(sink.opts?.providerOptions?.openai?.instructions || ''), /Reading Assistant/);
    // Turn system should not be the full catalog when envelope is empty.
    const systemMessages = Array.isArray(sink.opts?.prompt)
      ? sink.opts.prompt.filter((p) => p?.role === 'system')
      : [];
    const systemBlob = systemMessages
      .map((p) => (typeof p.content === 'string' ? p.content : JSON.stringify(p.content)))
      .join('\n');
    assert.doesNotMatch(systemBlob, /Available skills/);
  });
});
