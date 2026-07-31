import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assistantToModelMessages,
  buildModelMessages,
  legacyAssistantToModelMessages,
  serializeModelMessages,
} from './modelHistory.mjs';

describe('legacyAssistantToModelMessages', () => {
  it('replays reasoning + tool call/result for older sessions', () => {
    const messages = legacyAssistantToModelMessages({
      id: 'a1',
      role: 'assistant',
      content: 'Ahab hunts.',
      reasoning: 'look in extract',
      tools: [
        {
          id: 'tc1',
          name: 'read_file',
          args: { path: '/workspace/.wellread/extract/b/x.md' },
          result: { ok: true, text: 'whale' },
        },
      ],
    });
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'assistant');
    const parts = /** @type {Array<Record<string, unknown>>} */ (messages[0].content);
    assert.equal(parts[0].type, 'reasoning');
    assert.equal(parts[0].text, 'look in extract');
    assert.equal(parts[1].type, 'text');
    assert.equal(parts[2].type, 'tool-call');
    assert.equal(messages[1].role, 'tool');
    const toolParts = /** @type {Array<Record<string, unknown>>} */ (messages[1].content);
    assert.equal(toolParts[0].type, 'tool-result');
    assert.deepEqual(toolParts[0].output, {
      type: 'json',
      value: { ok: true, text: 'whale' },
    });
  });
});

describe('buildModelMessages', () => {
  it('prefers modelContent and persisted modelMessages', () => {
    const out = buildModelMessages({
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: '/skill:sum hi',
          modelContent: '<skill>hi</skill>',
        },
        {
          id: 'a1',
          role: 'assistant',
          content: 'ok',
          modelMessages: [
            { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
          ],
        },
      ],
      currentUserModelContent: 'next?',
    });
    assert.deepEqual(out[0], { role: 'user', content: '<skill>hi</skill>' });
    assert.deepEqual(out[1], {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
    });
    assert.deepEqual(out[2], { role: 'user', content: 'next?' });
  });

  it('excludes the in-flight user id', () => {
    const out = buildModelMessages({
      messages: [
        { id: 'u_old', role: 'user', content: 'old' },
        { id: 'u_new', role: 'user', content: 'new' },
      ],
      excludeMessageId: 'u_new',
      currentUserModelContent: 'new-model',
    });
    assert.deepEqual(out, [
      { role: 'user', content: 'old' },
      { role: 'user', content: 'new-model' },
    ]);
  });
});

describe('assistantToModelMessages', () => {
  it('uses modelMessages when present', () => {
    const out = assistantToModelMessages({
      id: 'a',
      role: 'assistant',
      content: 'display',
      modelMessages: [{ role: 'assistant', content: 'wire' }],
    });
    assert.deepEqual(out, [{ role: 'assistant', content: 'wire' }]);
  });
});

describe('serializeModelMessages', () => {
  it('returns JSON-safe clones', () => {
    const out = serializeModelMessages([
      { role: 'assistant', content: 'hi', nested: { n: 1 } },
    ]);
    assert.deepEqual(out, [{ role: 'assistant', content: 'hi', nested: { n: 1 } }]);
  });

  it('returns undefined for empty input', () => {
    assert.equal(serializeModelMessages([]), undefined);
    assert.equal(serializeModelMessages(null), undefined);
  });
});
