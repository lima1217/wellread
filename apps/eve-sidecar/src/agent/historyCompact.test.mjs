import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HISTORY_TOOL_RESULT_MAX_CHARS,
  compactHistoryToolResults,
  compactToolResultValue,
} from './historyCompact.mjs';
import { assistantToModelMessages } from './modelHistory.mjs';

const big = 'x'.repeat(HISTORY_TOOL_RESULT_MAX_CHARS + 100);

describe('compactToolResultValue', () => {
  it('keeps small results by identity', () => {
    const value = { ok: true, path: '/a', content: 'short' };
    assert.equal(compactToolResultValue(value), value);
  });

  it('stubs large section reads with locator fields and an excerpt', () => {
    const out = /** @type {Record<string, unknown>} */ (
      compactToolResultValue({
        ok: true,
        text: big,
        chunkCount: 12,
        via: 'index',
        sectionIndex: 3,
        title: 'Loomings',
      })
    );
    assert.equal(out.compacted, true);
    assert.equal(out.sectionIndex, 3);
    assert.equal(out.title, 'Loomings');
    assert.equal(out.chunkCount, 12);
    assert.equal(typeof out.excerpt, 'string');
    assert.ok(/** @type {string} */ (out.excerpt).length < 600);
    assert.equal(out.omittedChars, big.length - 480);
    assert.equal('text' in out, false);
  });

  it('is deterministic for cache-stable replay', () => {
    const v = { ok: true, content: big, path: '/p' };
    assert.deepEqual(compactToolResultValue(v), compactToolResultValue(v));
  });
});

describe('compactHistoryToolResults', () => {
  it('only rewrites tool-role result parts', () => {
    const messages = [
      { role: 'assistant', content: [{ type: 'text', text: big }] },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'read_section_text',
            output: { type: 'json', value: { ok: true, text: big } },
          },
          {
            type: 'tool-result',
            toolCallId: 'c2',
            toolName: 'grep',
            output: { type: 'json', value: { ok: true, hits: [] } },
          },
        ],
      },
    ];
    const out = compactHistoryToolResults(/** @type {any} */ (messages));
    assert.equal(out[0], messages[0]);
    const parts = /** @type {any} */ (out[1]).content;
    assert.equal(parts[0].output.value.compacted, true);
    assert.equal(parts[1], messages[1].content[1]);
  });

  it('applies to persisted assistant modelMessages on replay', () => {
    const out = assistantToModelMessages({
      id: 'a1',
      role: 'assistant',
      content: 'done',
      modelMessages: [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'c1',
              toolName: 'read_file',
              output: { type: 'json', value: { ok: true, path: '/x', content: big } },
            },
          ],
        },
      ],
    });
    const part = /** @type {any} */ (out[0]).content[0];
    assert.equal(part.output.value.compacted, true);
    assert.equal(part.output.value.path, '/x');
  });
});
