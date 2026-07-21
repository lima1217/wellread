import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import { runTurn } from './runTurn.mjs';

/**
 * @returns {import('./sessionStore.mjs').Session}
 */
function emptySession() {
  return {
    id: 'sess_test',
    bookId: 'book_1',
    bookTitle: 'Test Book',
    title: 'Chat about Test Book',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

/**
 * Model that calls `slow` once, then answers with text.
 */
function toolThenAnswerModel() {
  let callCount = 0;
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'tool-test',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('doGenerate unused');
    },
    doStream: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'tc_slow',
                toolName: 'slow',
                input: JSON.stringify({ q: 'whale' }),
              });
              controller.enqueue({
                type: 'finish',
                finishReason: 'tool-calls',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              });
              controller.close();
            },
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      }
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't1' });
            controller.enqueue({ type: 'text-delta', id: 't1', delta: 'Ahab hunts.' });
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

describe('runTurn tool trace timing', () => {
  it('emits tool.start while the tool is still running, before tool.end', async () => {
    const session = emptySession();
    /** @type {Array<Record<string, unknown>>} */
    const events = [];
    let toolRunning = false;
    let sawStartWhileRunning = false;

    const tools = {
      slow: tool({
        description: 'slow lookup',
        inputSchema: z.object({ q: z.string() }),
        execute: async ({ q }) => {
          toolRunning = true;
          await new Promise((r) => setTimeout(r, 60));
          toolRunning = false;
          return { hits: [q] };
        },
      }),
    };

    const result = await runTurn({
      model: /** @type {any} */ (toolThenAnswerModel()),
      session,
      userMessage: 'Who is Ahab?',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 1,
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'tool.start' && toolRunning) {
          sawStartWhileRunning = true;
        }
      },
    });

    assert.ok(result);
    const start = events.find((e) => e.type === 'tool.start');
    const end = events.find((e) => e.type === 'tool.end');
    assert.ok(start, 'expected tool.start');
    assert.ok(end, 'expected tool.end');
    assert.equal(start.name, 'slow');
    assert.equal(end.name, 'slow');
    assert.equal(start.id, end.id);
    assert.ok(
      events.indexOf(start) < events.indexOf(end),
      'tool.start must precede tool.end',
    );
    assert.equal(sawStartWhileRunning, true, 'tool.start must arrive during tool execution');
  });
});
