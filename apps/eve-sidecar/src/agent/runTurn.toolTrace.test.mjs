import { runTurn } from './runTurn.mjs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import {
  emptySession,
  run,
  toolThenAnswerModel,
} from './runTurn.testHarness.mjs';

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

