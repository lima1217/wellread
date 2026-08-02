import { tool } from 'ai';
import { runTurn, consumeUIMessageStream } from './runTurn.mjs';
import { parallelGate } from './toolParallelBudget.mjs';
import { readingToolContextSchema } from './tools.mjs';

/**
 * @returns {import('./sessionStore.mjs').Session}
 */
export function emptySession() {
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
export async function run(input) {
  const chunks = await consumeUIMessageStream(runTurn(input));
  const assistant =
    input.session.messages.filter((m) => m.role === 'assistant').at(-1) ?? null;
  return { chunks, assistant };
}

/**
 * Injected test tool that participates in the same toolsContext parallel budget
 * as production reading tools (contextSchema path; bindTurnTools will not wrap).
 *
 * @param {string} name
 * @param {{
 *   description: string,
 *   inputSchema: import('zod').ZodTypeAny,
 *   execute: (input: any, options: any) => Promise<any> | any,
 *   gateExtras?: Record<string, unknown>,
 * }} options
 */
export function mockReadingTool(name, options) {
  const { description, inputSchema, execute, gateExtras } = options;
  return tool({
    description,
    inputSchema,
    contextSchema: readingToolContextSchema,
    execute: async (input, opts) => {
      const blocked = parallelGate(opts.context.parallelBudget, name, gateExtras);
      if (blocked) return blocked;
      return execute(input, opts);
    },
  });
}

/**
 * Model that calls `slow` once, then answers with text.
 */
export function toolThenAnswerModel() {
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
export function narrateThenToolThenAnswerModel() {
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
export function answerWithWriteFileModel() {
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
export function toolThenDegenerateSoftLandingModel() {
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
export function narrateWithGrepOnlyModel() {
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

/** Tool once, then empty soft-landing (no prose). */
export function toolThenEmptySoftLandingModel() {
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
export function toolThenDsmlSoftLandingModel() {
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
export function manyParallelReadsThenAnswerModel(count) {
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

