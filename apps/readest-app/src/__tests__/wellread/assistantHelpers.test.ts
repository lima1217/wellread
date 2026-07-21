import { describe, expect, it } from 'vitest';
import {
  extractSourcesFromChunkMarkdown,
  formatPendingQuotesForTurn,
  formatWorkDuration,
  isReadingAssistantAvailable,
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

describe('extractSourcesFromChunkMarkdown', () => {
  it('reads cfi/endCfi/title from YAML frontmatter', () => {
    const md = `---
bookId: "abc"
sectionIndex: 2
title: "Chapter Two"
cfi: "epubcfi(/6/4!/4/2/1:0)"
endCfi: "epubcfi(/6/4!/4/2/1:40)"
chunkIndex: 0
---

Body text here.
`;
    expect(
      extractSourcesFromChunkMarkdown(md, '/workspace/.wellread/extract/abc/chunks/00001.md'),
    ).toEqual([
      {
        cfi: 'epubcfi(/6/4!/4/2/1:0)',
        endCfi: 'epubcfi(/6/4!/4/2/1:40)',
        title: 'Chapter Two',
        path: '/workspace/.wellread/extract/abc/chunks/00001.md',
      },
    ]);
  });

  it('returns empty when frontmatter has no cfi', () => {
    expect(extractSourcesFromChunkMarkdown('no frontmatter', '/x')).toEqual([]);
  });
});

describe('summarizeToolTrace', () => {
  it('returns an always-visible T3 summary line with step count', () => {
    expect(summarizeToolTrace([{ name: 'grep' }, { name: 'grep' }, { name: 'read_file' }])).toBe(
      'Searched extract · 3 steps',
    );
  });

  it('returns empty when there are no tools', () => {
    expect(summarizeToolTrace([])).toBe('');
  });

  it('uses singular step for one tool call', () => {
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
