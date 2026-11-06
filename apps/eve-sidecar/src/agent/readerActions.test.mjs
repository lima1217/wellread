import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSystemPrompt } from './prompt.mjs';
import { READER_ACTIONS } from './readerActions.mjs';
import { createToolParallelBudget } from './toolParallelBudget.mjs';
import { bindTurnTools } from './turnTools.mjs';

const ACTIONS = [
  'add_bookmark',
  'delete_annotation',
  'highlight',
  'list_annotations',
  'open_in_reader',
  'turn_page',
  'update_annotation',
];

describe('reader actions in the Reading Assistant', () => {
  it('are part of the in-app tool set', () => {
    const { tools } = bindTurnTools({ bookId: 'bk1', booksRoot: '/tmp/none' });
    for (const name of ACTIONS) assert.ok(tools[name], `${name} mounted`);
    assert.deepEqual(Object.keys(READER_ACTIONS).sort(), ACTIONS);
  });

  it('run through the turn context reader channel for the session book', async () => {
    const calls = [];
    const { tools, toolsContext } = bindTurnTools({
      bookId: 'bk1',
      booksRoot: '/tmp/none',
      runReaderCommand: async (bookId, type, args) => {
        calls.push({ bookId, type, args });
        return { ok: true, annotation: { id: 'n1' } };
      },
    });
    const out = await tools.highlight.execute(
      { text: 'Call me Ishmael', note: 'narrator' },
      { toolCallId: 't1', messages: [], context: toolsContext.highlight },
    );
    assert.deepEqual(out, { ok: true, annotation: { id: 'n1' } });
    assert.deepEqual(calls, [
      { bookId: 'bk1', type: 'highlight', args: { text: 'Call me Ishmael', note: 'narrator' } },
    ]);
  });

  it('answer reader_unavailable without a reader channel', async () => {
    const { tools, toolsContext } = bindTurnTools({ bookId: 'bk1', booksRoot: '/tmp/none' });
    const out = await tools.turn_page.execute(
      { direction: 'next' },
      { toolCallId: 't1', messages: [], context: toolsContext.turn_page },
    );
    assert.equal(out.error, 'reader_unavailable');
  });

  it('count against the per-step write budget', async () => {
    const budget = createToolParallelBudget();
    budget.beginStep();
    const { tools, toolsContext } = bindTurnTools({
      bookId: 'bk1',
      booksRoot: '/tmp/none',
      runReaderCommand: async () => ({ ok: true }),
    });
    const ctx = { ...toolsContext.highlight, parallelBudget: budget };
    const results = [];
    for (let i = 0; i < 17; i++) {
      results.push(
        await tools.highlight.execute({ text: `p${i}` }, { toolCallId: `t${i}`, messages: [], context: ctx }),
      );
    }
    assert.equal(results.filter((r) => r.ok).length, 16);
    assert.equal(results.at(-1).error, 'too_many_parallel_tools');
  });

  it('are explained in the system prompt', () => {
    const prompt = buildSystemPrompt({ bookId: 'bk1', bookTitle: 'Moby-Dick' });
    assert.match(prompt, /## Acting in the reader/);
    assert.match(prompt, /open_in_reader/);
    assert.match(prompt, /exactly as the book prints it/);
  });
});
