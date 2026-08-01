import { describe, expect, it } from 'vitest';
import {
  formatEveSourceLabel,
  formatWorkDuration,
  hydrateEveMessagesForDisplay,
  isAssistantSourceHref,
  isExternalHttpHref,
  isReadingAssistantAvailable,
  linkifyBareEpubCfi,
  normalizeEpubCfi,
  resolveEveSource,
  shouldPushAgentSessionToStore,
  shouldShowPendingReply,
  stripAssistantCfiCitations,
  summarizeToolTrace,
  assistantPartInputsFromMessage,
  coalesceAssistantParts,
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

describe('assistantPartInputsFromMessage', () => {
  it('maps tool-* and dynamic-tool via eve-message (parts authoritative)', () => {
    expect(
      assistantPartInputsFromMessage({
        content: 'final',
        parts: [
          { type: 'reasoning', text: 'think' },
          {
            type: 'tool-grep',
            toolCallId: 'c1',
            input: { q: 'x' },
            output: { hits: 1 },
          },
          {
            type: 'dynamic-tool',
            toolCallId: 'c2',
            toolName: 'read_file',
            input: { path: 'a.md' },
          },
          { type: 'text', text: 'final' },
        ],
      }),
    ).toEqual([
      { kind: 'reasoning', text: 'think' },
      {
        kind: 'tool',
        tool: { id: 'c1', name: 'grep', args: { q: 'x' }, result: { hits: 1 } },
      },
      {
        kind: 'tool',
        tool: { id: 'c2', name: 'read_file', args: { path: 'a.md' }, result: undefined },
      },
      { kind: 'text', text: 'final' },
    ]);
  });

  it('falls back to flat fields when parts are absent', () => {
    expect(
      assistantPartInputsFromMessage({
        content: 'hi',
        reasoning: 'r',
        tools: [{ id: 't1', name: 'grep' }],
      }),
    ).toEqual([
      { kind: 'reasoning', text: 'r' },
      { kind: 'tool', tool: { id: 't1', name: 'grep' } },
      { kind: 'text', text: 'hi' },
    ]);
  });
});

describe('coalesceAssistantParts', () => {
  it('groups consecutive tools into one segment', () => {
    expect(
      coalesceAssistantParts([
        { kind: 'reasoning', text: 'plan' },
        { kind: 'tool', tool: { id: 't1', name: 'read_file' } },
        { kind: 'tool', tool: { id: 't2', name: 'grep' } },
        { kind: 'text', text: 'answer' },
      ]),
    ).toEqual([
      { kind: 'reasoning', text: 'plan' },
      {
        kind: 'tools',
        tools: [
          { id: 't1', name: 'read_file' },
          { id: 't2', name: 'grep' },
        ],
      },
      { kind: 'text', text: 'answer' },
    ]);
  });

  it('splits tool groups when text or reasoning interrupts', () => {
    expect(
      coalesceAssistantParts([
        { kind: 'tool', tool: { id: 't1', name: 'read_file' } },
        { kind: 'text', text: 'mid' },
        { kind: 'tool', tool: { id: 't2', name: 'write_file' } },
      ]),
    ).toEqual([
      { kind: 'tools', tools: [{ id: 't1', name: 'read_file' }] },
      { kind: 'text', text: 'mid' },
      { kind: 'tools', tools: [{ id: 't2', name: 'write_file' }] },
    ]);
  });

  it('merges adjacent reasoning chunks before tools', () => {
    expect(
      coalesceAssistantParts([
        { kind: 'reasoning', text: 'a' },
        { kind: 'reasoning', text: 'b' },
        { kind: 'tool', tool: { id: 't1', name: 'grep' } },
      ]),
    ).toEqual([
      { kind: 'reasoning', text: 'ab' },
      { kind: 'tools', tools: [{ id: 't1', name: 'grep' }] },
    ]);
  });
});

describe('summarizeToolTrace', () => {
  it('summarizes search tools as Searched extract', () => {
    expect(summarizeToolTrace([{ name: 'grep' }, { name: 'grep' }, { name: 'read_file' }])).toEqual(
      { label: 'Searched extract', count: 3 },
    );
  });

  it('summarizes write_file tools as Saved notes', () => {
    expect(summarizeToolTrace([{ name: 'write_file' }, { name: 'write_file' }])).toEqual({
      label: 'Saved notes',
      count: 2,
    });
  });

  it('uses Saved notes when the only tools are writes', () => {
    expect(summarizeToolTrace([{ name: 'write_file' }])).toEqual({
      label: 'Saved notes',
      count: 1,
    });
  });

  it('returns null when there are no tools', () => {
    expect(summarizeToolTrace([])).toBeNull();
  });

  it('uses Searched extract for one search tool call', () => {
    expect(summarizeToolTrace([{ name: 'grep' }])).toEqual({
      label: 'Searched extract',
      count: 1,
    });
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

  it('is false when the current turn only has tool parts so far', () => {
    expect(
      shouldShowPendingReply(true, [
        { role: 'user', content: 'why?' },
        {
          role: 'assistant',
          content: '',
          parts: [
            {
              type: 'dynamic-tool',
              toolCallId: 't1',
              toolName: 'grep',
              state: 'input-available',
              input: {},
            },
          ],
        },
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

  it('decodes percent-encoded brackets in epubcfi hrefs from markdown', () => {
    const encoded = 'epubcfi(/6/22!/4%5B7K4G0-68091712f90a44748ee492caf82b4796%5D/1:0)';
    const raw = 'epubcfi(/6/22!/4[7K4G0-68091712f90a44748ee492caf82b4796]/1:0)';
    expect(resolveEveSource([{ cfi: raw, title: '游戏机制和事件' }], { href: encoded })).toEqual({
      cfi: raw,
      title: '游戏机制和事件',
    });
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

describe('linkifyBareEpubCfi', () => {
  const cfi = 'epubcfi(/6/22!/4[7K4G0-68091712f90a44748ee492caf82b4796]/1:0)';
  const bare = '/6/26!/4[8IL20-68091712f90a44748ee492caf82b4796]/118/1:2';
  const bareWrapped = `epubcfi(${bare})`;

  it('turns bare epubcfi in prose into a markdown link with a safe label', () => {
    const input = `出自「游戏机制和事件」一节（cfi: ${cfi}）。后续论述可连起来看。`;
    expect(linkifyBareEpubCfi(input)).toBe(
      `出自「游戏机制和事件」一节（[Passage](<${cfi}>)）。后续论述可连起来看。`,
    );
  });

  it('wraps bare cfi paths after cfi: into jump links', () => {
    expect(linkifyBareEpubCfi(`一节（cfi: ${bare}）`)).toBe(`一节（[Passage](<${bareWrapped}>)）`);
    expect(linkifyBareEpubCfi(`一节（cfi: \`${bare}\`）`)).toBe(
      `一节（[Passage](<${bareWrapped}>)）`,
    );
  });

  it('uses matching source title as link label when available', () => {
    const input = `见此处（cfi: ${cfi}）`;
    expect(linkifyBareEpubCfi(input, [{ cfi, title: '游戏机制和事件' }])).toBe(
      `见此处（[游戏机制和事件](<${cfi}>)）`,
    );
  });

  it('matches sources when prose uses a bare path and sources store epubcfi(...)', () => {
    expect(linkifyBareEpubCfi(`见（cfi: ${bare}）`, [{ cfi: bareWrapped, title: '第二节' }])).toBe(
      `见（[第二节](<${bareWrapped}>)）`,
    );
  });

  it('unwraps cfi-only inline code into jump links', () => {
    expect(linkifyBareEpubCfi(`见 \`${cfi}\``)).toBe(`见 [Passage](<${cfi}>)`);
    expect(linkifyBareEpubCfi(`见 \`cfi: ${cfi}\``)).toBe(`见 [Passage](<${cfi}>)`);
    expect(linkifyBareEpubCfi(`见 \`cfi：${cfi}\``)).toBe(`见 [Passage](<${cfi}>)`);
    expect(linkifyBareEpubCfi(`一节（cfi: \`${cfi}\`）`)).toBe(`一节（[Passage](<${cfi}>)）`);
  });

  it('handles fullwidth cfi colon in prose', () => {
    expect(linkifyBareEpubCfi(`一节（cfi：${cfi}）`)).toBe(`一节（[Passage](<${cfi}>)）`);
  });

  it('does not double-wrap existing markdown links or non-cfi code', () => {
    const linked = `见 [原文](<${cfi}>)`;
    expect(linkifyBareEpubCfi(linked)).toBe(linked);
    expect(linkifyBareEpubCfi('用 `foo[bar]` 表示')).toBe('用 `foo[bar]` 表示');
    const fenced = `\`\`\`\n${cfi}\n\`\`\``;
    expect(linkifyBareEpubCfi(fenced)).toBe(fenced);
  });

  it('is a no-op when there is no epubcfi', () => {
    expect(linkifyBareEpubCfi('没有出处')).toBe('没有出处');
  });
});

describe('normalizeEpubCfi', () => {
  it('wraps bare paths and accepts epubcfi(...)', () => {
    expect(normalizeEpubCfi('/6/26!/4[id]/1:0')).toBe('epubcfi(/6/26!/4[id]/1:0)');
    expect(normalizeEpubCfi('epubcfi(/6/26!/4[id]/1:0)')).toBe('epubcfi(/6/26!/4[id]/1:0)');
    expect(normalizeEpubCfi('cfi: /6/26!/4[id]/1:0')).toBe('epubcfi(/6/26!/4[id]/1:0)');
    expect(normalizeEpubCfi('not a cfi')).toBe(null);
  });
});

describe('stripAssistantCfiCitations', () => {
  const bare = '/6/26!/4[8IL20-68091712f90a44748ee492caf82b4796]/118/1:2';
  const cfi = `epubcfi(${bare})`;

  it('removes parenthetical cfi citations and keeps prose', () => {
    expect(
      stripAssistantCfiCitations(
        `这句话出自「游戏机制和事件」一节（cfi: ${bare}）。要把后续论述连起来看。`,
      ),
    ).toBe('这句话出自「游戏机制和事件」一节。要把后续论述连起来看。');
  });

  it('keeps section titles from epubcfi markdown links, drops Passage labels', () => {
    expect(stripAssistantCfiCitations(`见 [游戏机制和事件](<${cfi}>) 所述。`)).toBe(
      '见 游戏机制和事件 所述。',
    );
    expect(stripAssistantCfiCitations(`见 [Passage](<${cfi}>) 所述。`)).toBe('见 所述。');
  });

  it('removes bare epubcfi and cfi-only inline code', () => {
    expect(stripAssistantCfiCitations(`文中 ${cfi} 可删。`)).toBe('文中 可删。');
    expect(stripAssistantCfiCitations(`文中 \`cfi: ${bare}\` 可删。`)).toBe('文中 可删。');
  });
});
