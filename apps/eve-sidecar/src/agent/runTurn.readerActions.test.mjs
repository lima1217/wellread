import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { emptySession, run } from './runTurn.testHarness.mjs';

/** Step 1 calls highlight; step 2 answers, recording the prompt it saw. */
function highlightThenAnswerModel(seen) {
  let calls = 0;
  const finish = (finishReason) => ({
    type: 'finish',
    finishReason,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  });
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'reader-action-test',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('doGenerate unused');
    },
    doStream: async (options) => {
      calls += 1;
      const parts =
        calls === 1
          ? [
              {
                type: 'tool-call',
                toolCallId: 'tc_hl',
                toolName: 'highlight',
                input: JSON.stringify({ text: 'Call me Ishmael.', note: 'the narrator' }),
              },
              finish('tool-calls'),
            ]
          : (seen.push(options.prompt),
            [
              { type: 'text-start', id: 't1' },
              { type: 'text-delta', id: 't1', delta: 'Highlighted it with a note.' },
              { type: 'text-end', id: 't1' },
              finish('stop'),
            ]);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            for (const p of parts) controller.enqueue(p);
            controller.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

describe('runTurn reader actions', () => {
  it('lets the in-app assistant highlight in the open reader', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'eve-reader-actions-')));
    const commands = [];
    const seen = [];
    try {
      const session = emptySession();
      const { assistant } = await run({
        model: /** @type {any} */ (highlightThenAnswerModel(seen)),
        session,
        userMessage: 'Highlight the first sentence and note who is speaking.',
        getBooksRoot: () => booksRoot,
        maxToolRounds: 2,
        runReaderCommand: async (bookId, type, args) => {
          commands.push({ bookId, type, args });
          return { ok: true, annotation: { id: 'n1', cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:16)' } };
        },
      });
      assert.deepEqual(commands, [
        {
          bookId: 'book_1',
          type: 'highlight',
          args: { text: 'Call me Ishmael.', note: 'the narrator' },
        },
      ]);
      // The reader's result is what the model sees next.
      assert.match(JSON.stringify(seen[0]), /n1/);
      assert.match(JSON.stringify(assistant), /Highlighted it with a note/);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });
});
