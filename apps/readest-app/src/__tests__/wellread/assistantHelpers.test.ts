import { describe, expect, it } from 'vitest';
import {
  buildReadingAssistantSystemPrompt,
  extractSourcesFromChunkMarkdown,
  formatAskAboutDraft,
  isReadingAssistantAvailable,
  summarizeToolTrace,
} from '@/services/wellread/assistant/helpers';

describe('isReadingAssistantAvailable', () => {
  it('requires model enabled, sidecar ready, and non-empty apiKey', () => {
    expect(
      isReadingAssistantAvailable({
        modelEnabled: true,
        sidecarReady: true,
        hasApiKey: true,
      }),
    ).toBe(true);
    expect(
      isReadingAssistantAvailable({
        modelEnabled: false,
        sidecarReady: true,
        hasApiKey: true,
      }),
    ).toBe(false);
    expect(
      isReadingAssistantAvailable({
        modelEnabled: true,
        sidecarReady: false,
        hasApiKey: true,
      }),
    ).toBe(false);
    expect(
      isReadingAssistantAvailable({
        modelEnabled: true,
        sidecarReady: true,
        hasApiKey: false,
      }),
    ).toBe(false);
  });
});

describe('formatAskAboutDraft', () => {
  it('prefill visible quote block plus empty follow-up prompt', () => {
    const draft = formatAskAboutDraft({
      text: ' selected line ',
      chapterTitle: 'Chapter 1',
    });
    expect(draft).toContain('> selected line');
    expect(draft).toContain('Chapter 1');
    expect(draft).toMatch(/Please answer based on the selection above:\s*$/);
    expect(draft).not.toMatch(/为什么|解释|总结/);
  });

  it('omits chapter line when title missing', () => {
    const draft = formatAskAboutDraft({ text: 'hello' });
    expect(draft).toContain('> hello');
    expect(draft).not.toContain('·');
  });
});

describe('buildReadingAssistantSystemPrompt', () => {
  it('injects bookId, extract root, write rules, and no cross-book', () => {
    const prompt = buildReadingAssistantSystemPrompt({
      bookId: 'abc123',
      bookTitle: 'Moby Dick',
    });
    expect(prompt).toContain('abc123');
    expect(prompt).toContain('Moby Dick');
    expect(prompt).toContain('/workspace/.wellread/extract/abc123/');
    expect(prompt).toContain('/workspace/.wellread/notes/abc123/');
    expect(prompt.toLowerCase()).toMatch(/do not|不要|勿/);
    expect(prompt).toMatch(/write_file/);
    expect(prompt.toLowerCase()).toMatch(/current book|当前书/);
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
  it('summarizes search-like tool calls', () => {
    expect(summarizeToolTrace([{ name: 'grep' }, { name: 'grep' }, { name: 'read_file' }])).toMatch(
      /3/,
    );
  });
});
