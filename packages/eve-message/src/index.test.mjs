import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  persistablePartsFromUIMessage,
  sessionToUIMessage,
  textFromUIMessage,
  toolsFromUIMessage,
  uiMessageToSession,
} from './index.mjs';

describe('persistablePartsFromUIMessage', () => {
  it('keeps interleaved order and normalizes tool-* to dynamic-tool', () => {
    const parts = persistablePartsFromUIMessage({
      parts: [
        { type: 'reasoning', text: 'think', state: 'done' },
        {
          type: 'tool-grep',
          toolCallId: 't1',
          state: 'output-available',
          input: { q: 'x' },
          output: { hits: 1 },
        },
        { type: 'text', text: 'answer', state: 'done' },
        {
          type: 'dynamic-tool',
          toolCallId: 't2',
          toolName: 'read_file',
          state: 'output-available',
          input: { path: 'a.md' },
          output: { ok: true },
        },
      ],
    });

    assert.deepEqual(
      parts.map((p) => p.type),
      ['reasoning', 'dynamic-tool', 'text', 'dynamic-tool'],
    );
    assert.equal(parts[1].toolName, 'grep');
    assert.equal(parts[3].toolName, 'read_file');
  });
});

describe('session ↔ UIMessage round-trip', () => {
  it('preserves ordered parts across sessionToUIMessage / uiMessageToSession', () => {
    const ui = {
      id: 'a1',
      role: 'assistant',
      metadata: { createdAt: 10, sources: [{ cfi: 'epubcfi(/6/2)' }] },
      parts: [
        { type: 'text', text: 'first', state: 'done' },
        {
          type: 'dynamic-tool',
          toolCallId: 't1',
          toolName: 'grep',
          state: 'output-available',
          input: { q: 'x' },
          output: { hits: 1 },
        },
        { type: 'text', text: 'second', state: 'done' },
      ],
    };

    const session = uiMessageToSession(ui);
    assert.equal(session.content, 'firstsecond');
    assert.deepEqual(
      session.parts?.map((p) => p.type),
      ['text', 'dynamic-tool', 'text'],
    );
    assert.equal(session.sources?.[0]?.cfi, 'epubcfi(/6/2)');

    const back = sessionToUIMessage(session);
    assert.deepEqual(
      back.parts.map((p) => (p.type === 'text' ? p.text : p.toolCallId)),
      ['first', 't1', 'second'],
    );
  });

  it('synthesizes parts from legacy flat assistant messages', () => {
    const ui = sessionToUIMessage({
      id: 'a1',
      role: 'assistant',
      content: 'Hello',
      reasoning: 'thought',
      createdAt: 1,
      tools: [{ id: 't1', name: 'grep', args: { q: 'x' }, result: { ok: true } }],
    });
    assert.deepEqual(
      ui.parts.map((p) => p.type),
      ['reasoning', 'dynamic-tool', 'text'],
    );
    assert.equal(textFromUIMessage(ui), 'Hello');
    assert.equal(toolsFromUIMessage(ui)[0]?.name, 'grep');
  });
});
