import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import {
  enrichUIMessageStreamWithSources,
  runTurn,
  consumeUIMessageStream,
} from './runTurn.mjs';
import { TOOLS_READY_CONTINUE_HINT } from './sanitizeModelReply.mjs';
import { MAX_PARALLEL_READ_TOOLS } from './toolParallelBudget.mjs';
import { DEFAULT_FINAL_MAX_OUTPUT_TOKENS } from './toolRounds.mjs';

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
 * @param {Parameters<typeof runTurn>[0]} input
 */
async function run(input) {
  const chunks = await consumeUIMessageStream(runTurn(input));
  const assistant =
    input.session.messages.filter((m) => m.role === 'assistant').at(-1) ?? null;
  return { chunks, assistant };
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

describe('runTurn visible model output', () => {
  it('keeps tool-step narration in the visible assistant answer', async () => {
    const session = emptySession();
    const tools = {
      lookup: tool({
        description: 'lookup',
        inputSchema: z.object({ q: z.string() }),
        execute: async ({ q }) => ({ hits: [q] }),
      }),
    };

    const { chunks, assistant } = await run({
      model: /** @type {any} */ (narrateThenToolThenAnswerModel()),
      session,
      userMessage: '1968 到今天发生了什么？',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
    });

    assert.ok(assistant);
    assert.match(assistant.content, /让我继续读/);
    assert.match(assistant.content, /指数型技术。/);
    const deltas = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => c.delta)
      .join('');
    assert.match(deltas, /让我继续读/);
    assert.match(deltas, /指数型技术。/);
  });

  it('keeps mixed write_file step narration', async () => {
    const session = emptySession();
    const tools = {
      write_file: tool({
        description: 'write',
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: async () => ({ ok: true }),
      }),
    };

    const { assistant } = await run({
      model: /** @type {any} */ (answerWithWriteFileModel()),
      session,
      userMessage: '保存这条笔记',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
    });

    assert.ok(assistant);
    assert.equal(assistant.content, '已写入笔记。');
    assert.equal(session.messages.at(-1)?.content, '已写入笔记。');
  });

  it('keeps research narration when soft-landing is empty', async () => {
    const session = emptySession();
    const tools = {
      grep: tool({
        description: 'grep',
        inputSchema: z.object({ q: z.string() }),
        execute: async ({ q }) => ({ hits: [q] }),
      }),
    };

    const { assistant } = await run({
      model: /** @type {any} */ (narrateWithGrepOnlyModel()),
      session,
      userMessage: '搜一下',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
    });

    assert.ok(assistant);
    assert.match(assistant.content, /让我继续搜/);
    assert.doesNotMatch(assistant.content, /工具调用次数已用尽/);
  });

  it('surfaces degenerate soft-landing prose as-is', async () => {
    const session = emptySession();
    const tools = {
      read_file: tool({
        description: 'read',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => ({ ok: true, path, content: 'x' }),
      }),
    };

    const { chunks, assistant } = await run({
      model: /** @type {any} */ (toolThenDegenerateSoftLandingModel()),
      session,
      userMessage: '核对全部 chunk',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
    });

    assert.ok(assistant);
    assert.match(assistant.content, /让我继续/);
    assert.doesNotMatch(assistant.content, /工具调用次数已用尽/);
    assert.equal(
      chunks.some((c) => c.type === 'error'),
      false,
    );
  });
});

/** Tool once, then empty soft-landing (no prose). */
function toolThenEmptySoftLandingModel() {
  let callCount = 0;
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'empty-after-tools',
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
                toolCallId: 'tc_empty_1',
                toolName: 'read_file',
                input: JSON.stringify({ path: '/workspace/a.md' }),
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

/** Tool once, then DSML dump as soft-landing prose. */
function toolThenDsmlSoftLandingModel() {
  let callCount = 0;
  const dsml = [
    'tool_calls>',
    '<invoke name="read_file">',
    '<parameter name="path" string="true">/workspace/.wellread/extract/x/chunks/00464.md</parameter>',
    '</invoke>',
  ].join(' ');
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'dsml-after-tools',
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
                toolCallId: 'tc_dsml_1',
                toolName: 'read_file',
                input: JSON.stringify({ path: '/workspace/a.md' }),
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
            controller.enqueue({ type: 'text-delta', id: 't1', delta: dsml });
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

/** Emit many parallel read_file calls in one step, then answer. */
function manyParallelReadsThenAnswerModel(count) {
  let callCount = 0;
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'many-parallel-reads',
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
              for (let i = 0; i < count; i += 1) {
                controller.enqueue({
                  type: 'tool-call',
                  toolCallId: `tc_par_${i}`,
                  toolName: 'read_file',
                  input: JSON.stringify({ path: `/workspace/c${i}.md` }),
                });
              }
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
              delta: '读完了。',
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

describe('runTurn empty / DSML soft-landing after tools', () => {
  it('persists a continue hint when tools ran but final prose is empty', async () => {
    const session = emptySession();
    const tools = {
      read_file: tool({
        description: 'read',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => ({ ok: true, path, content: 'x' }),
      }),
    };

    const { assistant, chunks } = await run({
      model: /** @type {any} */ (toolThenEmptySoftLandingModel()),
      session,
      userMessage: '总结这一章',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
    });

    assert.ok(assistant);
    assert.match(assistant.content, new RegExp(TOOLS_READY_CONTINUE_HINT));
    assert.equal(session.messages.some((m) => m.role === 'user'), true);
    assert.equal(
      chunks.some((c) => c.type === 'error'),
      false,
    );
  });

  it('strips DSML soft-landing and persists continue hint', async () => {
    const session = emptySession();
    const tools = {
      read_file: tool({
        description: 'read',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => ({ ok: true, path, content: 'x' }),
      }),
    };

    const { assistant, chunks } = await run({
      model: /** @type {any} */ (toolThenDsmlSoftLandingModel()),
      session,
      userMessage: '继续读',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
    });

    assert.ok(assistant);
    assert.doesNotMatch(assistant.content, /invoke/i);
    assert.match(assistant.content, new RegExp(TOOLS_READY_CONTINUE_HINT));
    const liveText = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => c.delta ?? '')
      .join('');
    assert.doesNotMatch(liveText, /invoke/i);
    assert.doesNotMatch(liveText, /tool_calls/i);
    assert.match(liveText, new RegExp(TOOLS_READY_CONTINUE_HINT));
  });

  it('injects final-step maxOutputTokens on soft-landing', async () => {
    const session = emptySession();
    /** @type {number[]} */
    const maxTokensSeen = [];
    let callCount = 0;
    const model = {
      specificationVersion: 'v2',
      provider: 'test',
      modelId: 'final-budget',
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error('doGenerate unused');
      },
      doStream: async (options) => {
        callCount += 1;
        maxTokensSeen.push(
          typeof options?.maxOutputTokens === 'number'
            ? options.maxOutputTokens
            : -1,
        );
        // Two tool-capable steps (maxToolRounds clamps to ≥2), then soft-landing.
        if (callCount <= 2) {
          return {
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: 'stream-start', warnings: [] });
                controller.enqueue({
                  type: 'tool-call',
                  toolCallId: `tc_budget_${callCount}`,
                  toolName: 'read_file',
                  input: JSON.stringify({ path: `/workspace/a${callCount}.md` }),
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
                delta: '终局回答。',
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
    const tools = {
      read_file: tool({
        description: 'read',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => ({ ok: true, path, content: 'x' }),
      }),
    };

    const { assistant } = await run({
      model: /** @type {any} */ (model),
      session,
      userMessage: '总结',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
    });

    assert.ok(assistant);
    assert.match(assistant.content, /终局回答/);
    // Steps 0–1 tool-capable (no forced budget); step 2 is soft-landing.
    assert.equal(maxTokensSeen[0], -1);
    assert.equal(maxTokensSeen[1], -1);
    assert.equal(maxTokensSeen[2], DEFAULT_FINAL_MAX_OUTPUT_TOKENS);
  });

  it('soft-fails excess parallel read_file in one step', async () => {
    const session = emptySession();
    /** @type {string[]} */
    const executed = [];
    const tools = {
      read_file: tool({
        description: 'read',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => {
          executed.push(path);
          return { ok: true, path, content: 'x' };
        },
      }),
    };

    const { assistant } = await run({
      model: /** @type {any} */ (
        manyParallelReadsThenAnswerModel(MAX_PARALLEL_READ_TOOLS + 3)
      ),
      session,
      userMessage: '读这些 chunk',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
    });

    assert.ok(assistant);
    assert.equal(executed.length, MAX_PARALLEL_READ_TOOLS);
    const capped = (assistant.tools ?? []).filter(
      (t) => t.result?.error === 'too_many_parallel_tools',
    );
    assert.equal(capped.length, 3);
    assert.match(assistant.content, /读完了/);
  });

  it('soft-fails excess parallel read_file via production toolsContext', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'eve-runturn-par-')));
    try {
      const session = emptySession();
      const { assistant } = await run({
        model: /** @type {any} */ (
          manyParallelReadsThenAnswerModel(MAX_PARALLEL_READ_TOOLS + 3)
        ),
        session,
        userMessage: '读这些 chunk',
        getBooksRoot: () => booksRoot,
        // omit tools → createReadingTools + readingToolsContext wiring
        maxToolRounds: 2,
      });

      assert.ok(assistant);
      const toolRows = assistant.tools ?? [];
      assert.equal(toolRows.length, MAX_PARALLEL_READ_TOOLS + 3);
      const capped = toolRows.filter(
        (t) => t.result?.error === 'too_many_parallel_tools',
      );
      assert.equal(capped.length, 3);
      assert.equal(
        toolRows.filter((t) => t.result?.error !== 'too_many_parallel_tools').length,
        MAX_PARALLEL_READ_TOOLS,
      );
      assert.match(assistant.content, /读完了/);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });
});

describe('runTurn parts persistence + live sources', () => {
  it('persists ordered parts (text can interleave with tools)', async () => {
    const session = emptySession();
    const tools = {
      grep: tool({
        description: 'grep',
        inputSchema: z.object({ q: z.string() }),
        execute: async ({ q }) => ({ hits: [q] }),
      }),
    };

    const { assistant } = await run({
      model: /** @type {any} */ (narrateThenToolThenAnswerModel()),
      session,
      userMessage: 'Who is Ahab?',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
    });

    assert.ok(assistant);
    assert.ok(Array.isArray(assistant.parts));
    assert.ok(assistant.parts.length >= 2);
    const types = assistant.parts.map((p) => p.type);
    assert.ok(types.includes('text'));
    assert.ok(types.includes('dynamic-tool') || types.some((t) => String(t).startsWith('tool-')));
  });

  it('emits message-metadata.sources as tool outputs arrive', async () => {
    const chunkMd = `---
cfi: "epubcfi(/6/2!)"
title: "Loomings"
---
Call me Ishmael.
`;
    const base = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'tool-input-available',
          toolCallId: 'tc1',
          toolName: 'read_file',
          input: { path: '/workspace/x.md' },
        });
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'tc1',
          output: { ok: true, path: '/workspace/x.md', content: chunkMd },
        });
        controller.enqueue({ type: 'finish', finishReason: 'stop' });
        controller.close();
      },
    });

    const chunks = await consumeUIMessageStream(enrichUIMessageStreamWithSources(base));
    const meta = chunks.find((c) => c.type === 'message-metadata');
    assert.ok(meta, 'expected message-metadata chunk');
    assert.equal(meta.messageMetadata?.sources?.[0]?.cfi, 'epubcfi(/6/2!)');
  });
});

describe('runTurn tool trace timing', () => {
  it('emits tool-input before tool-output while the tool is still running', async () => {
    const session = emptySession();
    let toolRunning = false;
    let sawInputWhileRunning = false;
    /** @type {import('ai').UIMessageChunk[]} */
    const chunks = [];

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

    const stream = runTurn({
      model: /** @type {any} */ (toolThenAnswerModel()),
      session,
      userMessage: 'Who is Ahab?',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
    });
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      if (
        (value.type === 'tool-input-available' ||
          value.type === 'tool-input-start') &&
        toolRunning
      ) {
        sawInputWhileRunning = true;
      }
    }

    const assistant =
      session.messages.filter((m) => m.role === 'assistant').at(-1) ?? null;
    assert.ok(assistant);
    const inputIdx = chunks.findIndex(
      (c) => c.type === 'tool-input-available' || c.type === 'tool-input-start',
    );
    const outputIdx = chunks.findIndex((c) => c.type === 'tool-output-available');
    assert.ok(inputIdx >= 0, 'expected tool-input-* chunk');
    assert.ok(outputIdx >= 0, 'expected tool-output-available chunk');
    assert.ok(
      inputIdx < outputIdx,
      'tool-input-* must precede tool-output-available',
    );
    assert.equal(
      sawInputWhileRunning,
      true,
      'tool-input-* must arrive during tool execution',
    );
  });

  it('logs onToolExecutionStart before execute body and End after success', async () => {
    const session = emptySession();
    /** @type {string[]} */
    const lines = [];
    const origError = console.error;
    console.error = (...args) => {
      lines.push(args.map(String).join(' '));
    };
    const prevLog = process.env.EVE_TURN_LOG;
    process.env.EVE_TURN_LOG = '1';
    let sawStartBeforeExecute = false;

    try {
      const tools = {
        slow: tool({
          description: 'slow lookup',
          inputSchema: z.object({ q: z.string() }),
          execute: async ({ q }) => {
            const startLogged = lines.some((line) => {
              try {
                const row = JSON.parse(line);
                return (
                  row.type === 'eve.tool_execution' &&
                  row.phase === 'start' &&
                  row.toolName === 'slow'
                );
              } catch {
                return false;
              }
            });
            sawStartBeforeExecute = startLogged;
            await new Promise((r) => setTimeout(r, 20));
            return { hits: [q] };
          },
        }),
      };

      await run({
        model: /** @type {any} */ (toolThenAnswerModel()),
        session,
        userMessage: 'Who is Ahab?',
        getBooksRoot: () => '/tmp/books-should-not-matter',
        tools,
        maxToolRounds: 2,
      });

      assert.equal(sawStartBeforeExecute, true);
      const endRow = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .find(
          (row) =>
            row &&
            row.type === 'eve.tool_execution' &&
            row.phase === 'end' &&
            row.toolName === 'slow',
        );
      assert.ok(endRow, 'expected tool_execution end log');
      assert.equal(endRow.toolOutputType, 'tool-result');
      assert.equal(typeof endRow.toolExecutionMs, 'number');
    } finally {
      console.error = origError;
      if (prevLog === undefined) delete process.env.EVE_TURN_LOG;
      else process.env.EVE_TURN_LOG = prevLog;
    }
  });

  it('logs onToolExecutionEnd with tool-error when execute throws', async () => {
    const session = emptySession();
    /** @type {string[]} */
    const lines = [];
    const origError = console.error;
    console.error = (...args) => {
      lines.push(args.map(String).join(' '));
    };
    const prevLog = process.env.EVE_TURN_LOG;
    process.env.EVE_TURN_LOG = '1';

    try {
      const tools = {
        slow: tool({
          description: 'slow lookup',
          inputSchema: z.object({ q: z.string() }),
          execute: async () => {
            throw new Error('tool boom');
          },
        }),
      };

      await run({
        model: /** @type {any} */ (toolThenAnswerModel()),
        session,
        userMessage: 'Who is Ahab?',
        getBooksRoot: () => '/tmp/books-should-not-matter',
        tools,
        maxToolRounds: 2,
      });

      const endRow = lines
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .find(
          (row) =>
            row &&
            row.type === 'eve.tool_execution' &&
            row.phase === 'end' &&
            row.toolName === 'slow',
        );
      assert.ok(endRow, 'expected tool_execution end log');
      assert.equal(endRow.toolOutputType, 'tool-error');
    } finally {
      console.error = origError;
      if (prevLog === undefined) delete process.env.EVE_TURN_LOG;
      else process.env.EVE_TURN_LOG = prevLog;
    }
  });
});
