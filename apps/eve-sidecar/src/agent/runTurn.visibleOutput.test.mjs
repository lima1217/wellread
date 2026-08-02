import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import {
  emptySession,
  run,
  narrateThenToolThenAnswerModel,
  answerWithWriteFileModel,
  narrateWithGrepOnlyModel,
  toolThenDegenerateSoftLandingModel,
} from './runTurn.testHarness.mjs';

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
