import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import {
  MAX_PARALLEL_READ_TOOLS,
  parallelGate,
} from './toolParallelBudget.mjs';
import { readingToolContextSchema } from './tools.mjs';
import { bindTurnTools, maybeAttachNativeWebSearch } from './turnTools.mjs';

describe('bindTurnTools', () => {
  it('wraps bare injected tools so parallel budget still applies', async () => {
    let ran = 0;
    const { tools, parallelBudget } = bindTurnTools({
      bookId: 'bk1',
      booksRoot: '/tmp',
      tools: {
        read_file: tool({
          description: 'bare read',
          inputSchema: z.object({ path: z.string() }),
          execute: async () => {
            ran += 1;
            return { ok: true };
          },
        }),
      },
    });
    parallelBudget.beginStep();
    for (let i = 0; i < MAX_PARALLEL_READ_TOOLS; i++) {
      const out = await tools.read_file.execute(
        { path: `/workspace/a${i}.md` },
        { toolCallId: `tc_${i}`, messages: [], abortSignal: undefined },
      );
      assert.equal(out.ok, true);
    }
    const blocked = await tools.read_file.execute(
      { path: '/workspace/over.md' },
      { toolCallId: 'tc_over', messages: [], abortSignal: undefined },
    );
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, 'too_many_parallel_tools');
    assert.equal(ran, MAX_PARALLEL_READ_TOOLS);
  });

  it('does not double-wrap tools that already use contextSchema', async () => {
    let gateHits = 0;
    let ran = 0;
    const { tools, toolsContext, parallelBudget } = bindTurnTools({
      bookId: 'bk1',
      booksRoot: '/tmp',
      tools: {
        read_file: tool({
          description: 'schema read',
          inputSchema: z.object({ path: z.string() }),
          contextSchema: readingToolContextSchema,
          execute: async (_input, opts) => {
            gateHits += 1;
            const blocked = parallelGate(opts.context.parallelBudget, 'read_file');
            if (blocked) return blocked;
            ran += 1;
            return { ok: true };
          },
        }),
      },
    });
    parallelBudget.beginStep();
    const ctx = toolsContext.read_file;
    for (let i = 0; i < MAX_PARALLEL_READ_TOOLS + 1; i++) {
      await tools.read_file.execute(
        { path: `/workspace/a${i}.md` },
        {
          toolCallId: `tc_${i}`,
          messages: [],
          abortSignal: undefined,
          context: ctx,
        },
      );
    }
    // One gate call per execute; wrap would have gated before execute and
    // reduced gateHits relative to invoke count.
    assert.equal(gateHits, MAX_PARALLEL_READ_TOOLS + 1);
    assert.equal(ran, MAX_PARALLEL_READ_TOOLS);
  });
});

describe('maybeAttachNativeWebSearch', () => {
  it('adds provider-executed web_search for DeepSeek responses without wrapping', () => {
    const base = { read_file: { description: 'x' } };
    const next = maybeAttachNativeWebSearch(base, {
      baseURL: 'https://api.deepseek.com/v1',
      apiMode: 'responses',
    });
    assert.ok(next.web_search);
    assert.equal(next.read_file, base.read_file);
    assert.equal(next.web_search.id, 'openai.web_search');
  });

  it('leaves tools unchanged for chat mode or non-DeepSeek hosts', () => {
    const base = { read_file: { description: 'x' } };
    assert.equal(
      maybeAttachNativeWebSearch(base, {
        baseURL: 'https://api.deepseek.com/v1',
        apiMode: 'chat',
      }),
      base,
    );
    assert.equal(
      maybeAttachNativeWebSearch(base, {
        baseURL: 'https://api.openai.com/v1',
        apiMode: 'responses',
      }),
      base,
    );
  });
});
