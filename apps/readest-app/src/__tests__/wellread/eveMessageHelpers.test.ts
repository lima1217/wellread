import { describe, expect, it } from 'vitest';
import {
  normalizeEveMessage,
  uiMessageToEveMessage,
  type EveMessage,
} from '@/services/wellread/assistant/eveClient';

describe('uiMessageToEveMessage', () => {
  it('flattens text, reasoning, and dynamic-tool parts', () => {
    const eve = uiMessageToEveMessage({
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'Let me think', state: 'done' },
        {
          type: 'dynamic-tool',
          toolCallId: 't1',
          toolName: 'grep',
          state: 'output-available',
          input: { q: 'vocation' },
          output: { hits: 2 },
        },
        { type: 'text', text: 'Because vocation.', state: 'done' },
      ],
    });

    expect(eve).toMatchObject({
      id: 'a1',
      role: 'assistant',
      content: 'Because vocation.',
      reasoning: 'Let me think',
      tools: [{ id: 't1', name: 'grep', args: { q: 'vocation' }, result: { hits: 2 } }],
    });
    expect(eve.parts).toHaveLength(3);
  });

  it('preserves pending quotes from extras', () => {
    const eve = uiMessageToEveMessage(
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'Why?', state: 'done' }],
      },
      { quotes: [{ text: 'quoted', chapterTitle: null }], createdAt: 42 },
    );

    expect(eve).toMatchObject({
      id: 'u1',
      role: 'user',
      content: 'Why?',
      createdAt: 42,
      quotes: [{ text: 'quoted', chapterTitle: null }],
    });
  });
});

describe('normalizeEveMessage', () => {
  it('re-derives denormalized fields when parts are present', () => {
    const msg: EveMessage = {
      id: 'a1',
      role: 'assistant',
      content: 'stale',
      createdAt: 1,
      parts: [{ type: 'text', text: 'fresh', state: 'done' }],
    };
    expect(normalizeEveMessage(msg).content).toBe('fresh');
  });

  it('preserves interleaved part order from disk (not forced reasoning→tools→text)', () => {
    const normalized = normalizeEveMessage({
      id: 'a1',
      role: 'assistant',
      content: 'firstsecond',
      createdAt: 1,
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
    });

    expect(normalized.parts?.map((p) => p.type)).toEqual(['text', 'dynamic-tool', 'text']);
    expect(normalized.content).toBe('firstsecond');
  });

  it('synthesizes parts from legacy flat assistant messages', () => {
    const normalized = normalizeEveMessage({
      id: 'a1',
      role: 'assistant',
      content: 'Hello',
      reasoning: 'thought',
      createdAt: 1,
      tools: [{ id: 't1', name: 'grep', args: { q: 'x' }, result: { ok: true } }],
    });

    expect(normalized.parts?.map((p) => p.type)).toEqual(['reasoning', 'dynamic-tool', 'text']);
    expect(normalized.content).toBe('Hello');
    expect(normalized.reasoning).toBe('thought');
  });
});
