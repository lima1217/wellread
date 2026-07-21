import { describe, expect, it } from 'vitest';
import {
  formatPendingQuotesForTurn,
  formatWorkDuration,
  isReadingAssistantAvailable,
  shouldPushAgentSessionToStore,
  shouldShowPendingReply,
  summarizeToolTrace,
} from '@/services/wellread/assistant/helpers';

describe('isReadingAssistantAvailable', () => {
  it('requires enabled, sidecar ready, valid active profile, and non-empty apiKey', () => {
    expect(
      isReadingAssistantAvailable({
        modelEnabled: true,
        sidecarReady: true,
        hasActiveProfile: true,
        hasApiKey: true,
      }),
    ).toBe(true);
    expect(
      isReadingAssistantAvailable({
        modelEnabled: false,
        sidecarReady: true,
        hasActiveProfile: true,
        hasApiKey: true,
      }),
    ).toBe(false);
    expect(
      isReadingAssistantAvailable({
        modelEnabled: true,
        sidecarReady: false,
        hasActiveProfile: true,
        hasApiKey: true,
      }),
    ).toBe(false);
    expect(
      isReadingAssistantAvailable({
        modelEnabled: true,
        sidecarReady: true,
        hasActiveProfile: false,
        hasApiKey: true,
      }),
    ).toBe(false);
    expect(
      isReadingAssistantAvailable({
        modelEnabled: true,
        sidecarReady: true,
        hasActiveProfile: true,
        hasApiKey: false,
      }),
    ).toBe(false);
  });
});

describe('formatPendingQuotesForTurn', () => {
  it('joins quote blockquotes with the user question for the model wire', () => {
    const wire = formatPendingQuotesForTurn(
      [{ text: ' selected line ', chapterTitle: 'Chapter 1' }, { text: 'second' }],
      ' What does this mean? ',
    );
    expect(wire).toBe(
      ['> selected line', '> — 《Chapter 1》', '', '> second', '', 'What does this mean?'].join(
        '\n',
      ),
    );
  });

  it('omits chapter line and empty quotes', () => {
    expect(formatPendingQuotesForTurn([{ text: 'hello' }, { text: '  ' }], 'ask')).toBe(
      ['> hello', '', 'ask'].join('\n'),
    );
  });
});

describe('summarizeToolTrace', () => {
  it('summarizes search tools as Searched extract', () => {
    expect(summarizeToolTrace([{ name: 'grep' }, { name: 'grep' }, { name: 'read_file' }])).toBe(
      'Searched extract · 3 steps',
    );
  });

  it('summarizes write_file tools as Saved notes', () => {
    expect(summarizeToolTrace([{ name: 'write_file' }, { name: 'write_file' }])).toBe(
      'Saved notes · 2 steps',
    );
  });

  it('uses Saved notes when the only tools are writes', () => {
    expect(summarizeToolTrace([{ name: 'write_file' }])).toBe('Saved notes · 1 step');
  });

  it('returns empty when there are no tools', () => {
    expect(summarizeToolTrace([])).toBe('');
  });

  it('uses singular step for one search tool call', () => {
    expect(summarizeToolTrace([{ name: 'grep' }])).toBe('Searched extract · 1 step');
  });
});

describe('shouldShowPendingReply', () => {
  it('is false when not busy', () => {
    expect(shouldShowPendingReply(false, [{ role: 'user', content: 'hi' }])).toBe(false);
  });

  it('is true on a later turn while waiting after prior assistant replies', () => {
    expect(
      shouldShowPendingReply(true, [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer one' },
        { role: 'user', content: 'second' },
      ]),
    ).toBe(true);
  });

  it('is false once the current turn has assistant text', () => {
    expect(
      shouldShowPendingReply(true, [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'answer one' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'answer two' },
      ]),
    ).toBe(false);
  });

  it('is false when the current turn only has reasoning so far', () => {
    expect(
      shouldShowPendingReply(true, [
        { role: 'user', content: 'why?' },
        { role: 'assistant', content: '', reasoning: 'Let me think…' },
      ]),
    ).toBe(false);
  });
});

describe('formatWorkDuration', () => {
  it('rounds to whole seconds and floors sub-second work to 1s', () => {
    expect(formatWorkDuration(0)).toBe('1s');
    expect(formatWorkDuration(400)).toBe('1s');
    expect(formatWorkDuration(12_400)).toBe('12s');
  });

  it('formats minute spans without trailing zero seconds', () => {
    expect(formatWorkDuration(60_000)).toBe('1m');
    expect(formatWorkDuration(125_000)).toBe('2m 5s');
  });
});

describe('shouldPushAgentSessionToStore', () => {
  it('does not restore a stale agent id after New chat clears the store', () => {
    // Store → null first; agent still holds the previous id for one paint.
    expect(
      shouldPushAgentSessionToStore({
        agentSessionId: 'ses_old',
        previousAgentSessionId: 'ses_old',
        storeSessionId: null,
        storeBookId: 'book-1',
        bookId: 'book-1',
      }),
    ).toBe(false);
  });

  it('pushes when the agent mints a session on first send (lazy create)', () => {
    expect(
      shouldPushAgentSessionToStore({
        agentSessionId: 'ses_new',
        previousAgentSessionId: null,
        storeSessionId: null,
        storeBookId: 'book-1',
        bookId: 'book-1',
      }),
    ).toBe(true);
  });

  it('is a no-op when store already matches the agent', () => {
    expect(
      shouldPushAgentSessionToStore({
        agentSessionId: 'ses_1',
        previousAgentSessionId: null,
        storeSessionId: 'ses_1',
        storeBookId: 'book-1',
        bookId: 'book-1',
      }),
    ).toBe(false);
  });
});
