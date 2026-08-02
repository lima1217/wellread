import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOOLS_READY_CONTINUE_HINT } from './sanitizeModelReply.mjs';
import { MAX_PARALLEL_READ_TOOLS } from './toolParallelBudget.mjs';
import { DEFAULT_FINAL_MAX_OUTPUT_TOKENS } from './toolRounds.mjs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import {
  emptySession,
  run,
  mockReadingTool,
  toolThenEmptySoftLandingModel,
  toolThenDsmlSoftLandingModel,
  manyParallelReadsThenAnswerModel,
} from './runTurn.testHarness.mjs';

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
      read_file: mockReadingTool('read_file', {
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

