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

/**
 * Step 1 narrates then calls a tool; step 2 returns the real answer.
 * Visible content must not include the narration.
 */
function narrateThenToolThenAnswerModel() {
  let callCount = 0;
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'narration-test',
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
              controller.enqueue({ type: 'text-start', id: 't0' });
              controller.enqueue({
                type: 'text-delta',
                id: 't0',
                delta: '让我继续读第一章。',
              });
              controller.enqueue({ type: 'text-end', id: 't0' });
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'tc_lookup',
                toolName: 'lookup',
                input: JSON.stringify({ q: 'exponential' }),
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
            controller.enqueue({
              type: 'text-delta',
              id: 't1',
              delta: '指数型技术。',
            });
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

/** Single step: answer text + write_file (recoverable mixed). */
function answerWithWriteFileModel() {
  let callCount = 0;
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'write-mixed-test',
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
              controller.enqueue({ type: 'text-start', id: 't0' });
              controller.enqueue({
                type: 'text-delta',
                id: 't0',
                delta: '已写入笔记。',
              });
              controller.enqueue({ type: 'text-end', id: 't0' });
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'tc_write',
                toolName: 'write_file',
                input: JSON.stringify({ path: 'log.md', content: 'x' }),
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
      // Empty follow-up (under budget) so confirmation comes from toolTrace,
      // not a later tool-free prose step.
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
            });
            controller.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

/**
 * Two tool steps then a soft-landing ellipsis loop (maxToolRounds clamps to ≥2).
 */
function toolThenDegenerateSoftLandingModel() {
  let callCount = 0;
  const bad = Array.from({ length: 40 }, () => '…让我继续。……（中间略）…').join(
    '\n',
  );
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'degenerate-soft-landing',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('doGenerate unused');
    },
    doStream: async () => {
      callCount += 1;
      if (callCount <= 2) {
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({
                type: 'tool-call',
                toolCallId: `tc_read_${callCount}`,
                toolName: 'read_file',
                input: JSON.stringify({
                  path: `/workspace/chunk-${callCount}.md`,
                }),
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
            controller.enqueue({
              type: 'text-delta',
              id: 't1',
              delta: `（续）… BCI…\n\n${bad}`,
            });
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

/** Research narration + grep twice, then empty soft-landing. */
function narrateWithGrepOnlyModel() {
  let callCount = 0;
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'grep-narration-test',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('doGenerate unused');
    },
    doStream: async () => {
      callCount += 1;
      if (callCount <= 2) {
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'stream-start', warnings: [] });
              controller.enqueue({ type: 'text-start', id: 't0' });
              controller.enqueue({
                type: 'text-delta',
                id: 't0',
                delta: '让我继续搜。',
              });
              controller.enqueue({ type: 'text-end', id: 't0' });
              controller.enqueue({
                type: 'tool-call',
                toolCallId: `tc_grep_${callCount}`,
                toolName: 'grep',
                input: JSON.stringify({ q: 'whale', path: `/workspace/g${callCount}.md` }),
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
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
            });
            controller.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

describe('runTurn answer content gating', () => {
  it('omits tool-step narration from the visible assistant answer', async () => {
    const session = emptySession();
    /** @type {Array<Record<string, unknown>>} */
    const events = [];
    const tools = {
      lookup: tool({
        description: 'lookup',
        inputSchema: z.object({ q: z.string() }),
        execute: async ({ q }) => ({ hits: [q] }),
      }),
    };

    const result = await runTurn({
      model: /** @type {any} */ (narrateThenToolThenAnswerModel()),
      session,
      userMessage: '1968 到今天发生了什么？',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
      onEvent: (event) => events.push(event),
    });

    assert.ok(result);
    assert.equal(result.content, '指数型技术。');
    assert.equal(
      result.content.includes('让我继续读'),
      false,
      'tool-step narration must not enter content',
    );
    const deltas = events
      .filter((e) => e.type === 'message.assistant.delta')
      .map((e) => e.delta)
      .join('');
    assert.equal(deltas.includes('让我继续读'), false);
    assert.equal(deltas.includes('指数型技术。'), true);
  });

  it('synthesizes write confirmation from write_file paths', async () => {
    const session = emptySession();
    /** @type {Array<Record<string, unknown>>} */
    const events = [];
    const tools = {
      write_file: tool({
        description: 'write',
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: async () => ({ ok: true }),
      }),
    };

    const result = await runTurn({
      model: /** @type {any} */ (answerWithWriteFileModel()),
      session,
      userMessage: '保存这条笔记',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
      onEvent: (event) => events.push(event),
    });

    assert.ok(result);
    assert.equal(result.content, '已写入：log.md');
    assert.equal(session.messages.at(-1)?.content, '已写入：log.md');
  });

  it('does not recover research-tool narration when there is no final answer', async () => {
    const session = emptySession();
    /** @type {Array<Record<string, unknown>>} */
    const events = [];
    const tools = {
      grep: tool({
        description: 'grep',
        inputSchema: z.object({ q: z.string() }),
        execute: async ({ q }) => ({ hits: [q] }),
      }),
    };

    const result = await runTurn({
      model: /** @type {any} */ (narrateWithGrepOnlyModel()),
      session,
      userMessage: '搜一下',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
      onEvent: (event) => events.push(event),
    });

    // Soft-landing replaces model prose with a tool ledger.
    assert.ok(result);
    assert.match(result.content, /工具调用次数已用尽/);
    assert.equal(result.content.includes('让我继续搜'), false);
  });

  it('replaces degenerate soft-landing prose with a tool ledger', async () => {
    const session = emptySession();
    /** @type {Array<Record<string, unknown>>} */
    const events = [];
    const tools = {
      read_file: tool({
        description: 'read',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => ({ ok: true, path, content: 'x' }),
      }),
    };

    const result = await runTurn({
      model: /** @type {any} */ (toolThenDegenerateSoftLandingModel()),
      session,
      userMessage: '核对全部 chunk',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
      onEvent: (event) => events.push(event),
    });

    assert.ok(result);
    assert.match(result.content, /工具调用次数已用尽/);
    assert.match(result.content, /chunk-1\.md/);
    assert.equal(result.content.includes('让我继续'), false);
    assert.equal(
      events.some((e) => e.type === 'error'),
      false,
    );
  });
});

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
      // Keep a spare tool-capable step so the final prose is not soft-landing.
      maxToolRounds: 2,
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
