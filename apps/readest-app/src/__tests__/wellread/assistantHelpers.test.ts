import { describe, expect, it } from 'vitest';
import {
  formatEveSourceLabel,
  formatPendingQuotesForTurn,
  formatWorkDuration,
  hydrateEveMessagesForDisplay,
  isAssistantSourceHref,
  isExternalHttpHref,
  isReadingAssistantAvailable,
  parsePendingQuotesFromWire,
  resolveEveSource,
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

describe('parsePendingQuotesFromWire', () => {
  it('round-trips formatPendingQuotesForTurn into QuoteStack fields', () => {
    const quotes = [
      { text: 'selected line', chapterTitle: 'Chapter 1' },
      { text: 'second', chapterTitle: null },
    ];
    const wire = formatPendingQuotesForTurn(quotes, 'What does this mean?');
    expect(parsePendingQuotesFromWire(wire)).toEqual({
      quotes: [
        { text: 'selected line', chapterTitle: 'Chapter 1' },
        { text: 'second', chapterTitle: null },
      ],
      content: 'What does this mean?',
    });
  });

  it('leaves plain user text alone', () => {
    expect(parsePendingQuotesFromWire('Just a question')).toEqual({
      quotes: [],
      content: 'Just a question',
    });
  });
});

describe('hydrateEveMessagesForDisplay', () => {
  it('splits persisted wire user content into quotes + question', () => {
    const hydrated = hydrateEveMessagesForDisplay([
      {
        id: 'u1',
        role: 'user',
        content: '> But back to Hardy.\n\nWhy did he stop?',
        createdAt: 1,
      },
      {
        id: 'a1',
        role: 'assistant',
        content: 'Because…',
        createdAt: 2,
      },
    ]);
    expect(hydrated[0]).toEqual({
      id: 'u1',
      role: 'user',
      content: 'Why did he stop?',
      createdAt: 1,
      quotes: [{ text: 'But back to Hardy.', chapterTitle: null }],
    });
    expect(hydrated[1]).toEqual({
      id: 'a1',
      role: 'assistant',
      content: 'Because…',
      createdAt: 2,
    });
  });

  it('keeps client quotes when already present', () => {
    const msg = {
      id: 'u1',
      role: 'user' as const,
      content: 'Why?',
      createdAt: 1,
      quotes: [{ text: 'already', chapterTitle: null }],
    };
    expect(hydrateEveMessagesForDisplay([msg])[0]).toEqual(msg);
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

describe('isAssistantSourceHref', () => {
  it('detects extract chunk paths and epubcfi hrefs', () => {
    expect(isAssistantSourceHref('chunks/00021-section-21.md')).toBe(true);
    expect(
      isAssistantSourceHref('/workspace/.wellread/extract/abc/chunks/00021-section-21.md'),
    ).toBe(true);
    expect(isAssistantSourceHref('epubcfi(/6/36!/4/2/1:0)')).toBe(true);
    expect(isAssistantSourceHref('https://example.com/doc')).toBe(false);
    expect(isAssistantSourceHref(null)).toBe(false);
  });
});

describe('isExternalHttpHref', () => {
  it('accepts only absolute http(s) URLs', () => {
    expect(isExternalHttpHref('https://example.com/a')).toBe(true);
    expect(isExternalHttpHref('http://example.com/a')).toBe(true);
    expect(isExternalHttpHref('chunks/00021-section-21.md')).toBe(false);
    expect(isExternalHttpHref('/workspace/.wellread/extract/x.md')).toBe(false);
    expect(isExternalHttpHref('file:///tmp/x.md')).toBe(false);
    expect(isExternalHttpHref(null)).toBe(false);
  });
});

describe('resolveEveSource', () => {
  const sources = [
    {
      cfi: 'epubcfi(/6/36!/4/2/1:0)',
      title: 'Section 21',
      path: '/workspace/.wellread/extract/bk/chunks/00021-section-21.md',
    },
    {
      cfi: 'epubcfi(/6/4!/4/2/1:0)',
      title: 'Preface',
      path: '/workspace/.wellread/extract/bk/chunks/00001-preface.md',
    },
  ];

  it('matches chunk markdown hrefs to source path', () => {
    expect(resolveEveSource(sources, { href: 'chunks/00021-section-21.md' })?.cfi).toBe(
      'epubcfi(/6/36!/4/2/1:0)',
    );
    expect(
      resolveEveSource(sources, {
        href: '/workspace/.wellread/extract/bk/chunks/00021-section-21.md',
      })?.cfi,
    ).toBe('epubcfi(/6/36!/4/2/1:0)');
  });

  it('matches link label to source title when href is missing or unmatched', () => {
    expect(resolveEveSource(sources, { label: 'Section 21' })?.cfi).toBe('epubcfi(/6/36!/4/2/1:0)');
  });

  it('resolves bare epubcfi hrefs even without a sources entry', () => {
    expect(resolveEveSource([], { href: 'epubcfi(/6/8!/4/1:0)' })?.cfi).toBe(
      'epubcfi(/6/8!/4/1:0)',
    );
  });

  it('returns null when nothing matches', () => {
    expect(resolveEveSource(sources, { href: 'https://example.com', label: 'Elsewhere' })).toBe(
      null,
    );
  });
});

describe('formatEveSourceLabel', () => {
  it('prefers title and falls back to Source N', () => {
    expect(formatEveSourceLabel({ cfi: 'x', title: 'Section 21' }, 0)).toBe('Section 21');
    expect(formatEveSourceLabel({ cfi: 'x' }, 2)).toBe('Source 3');
  });
});
