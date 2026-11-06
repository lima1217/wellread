import { describe, expect, it } from 'vitest';
import {
  buildReaderLivePayload,
  claudeMcpAddCommand,
  mcpServersJson,
  readerStateFromProgress,
} from '@/services/wellread/assistant/readerLive';

const progress = { location: 'epubcfi(/6/4!/4/2)', sectionLabel: 'Loomings', index: 1 };

describe('readerStateFromProgress', () => {
  it('maps progress to the sidecar reader state', () => {
    expect(readerStateFromProgress(progress)).toEqual({
      chapter: 'Loomings',
      cfi: 'epubcfi(/6/4!/4/2)',
      sectionIndex: 1,
    });
    expect(readerStateFromProgress(null)).toBeNull();
    expect(readerStateFromProgress({ location: '', sectionLabel: '', index: 0 })).toBeNull();
    expect(readerStateFromProgress({ location: 'x', sectionLabel: '', index: -1 })).toEqual({
      cfi: 'x',
    });
  });
});

describe('buildReaderLivePayload', () => {
  const base = {
    bookId: 'bk1',
    bookTitle: 'Moby-Dick',
    progress,
    selection: null,
    pendingQuotes: [
      { text: 'Call me Ishmael.', chapterTitle: 'Loomings', cfi: 'epubcfi(/6/4!/4/2/1:0)' },
    ],
    pendingQuotesBookId: 'bk1',
    spoilerGuard: true,
    shareAnnotations: false,
  };

  it('carries the selection with its chapter, quotes and settings', () => {
    const payload = buildReaderLivePayload({
      ...base,
      selection: { text: '  some years ago ', cfi: 'epubcfi(/6/4!/4/2/1:9)' },
    });
    expect(payload).toEqual({
      bookId: 'bk1',
      bookTitle: 'Moby-Dick',
      readerState: { chapter: 'Loomings', cfi: 'epubcfi(/6/4!/4/2)', sectionIndex: 1 },
      selection: {
        text: 'some years ago',
        chapterTitle: 'Loomings',
        cfi: 'epubcfi(/6/4!/4/2/1:9)',
      },
      pendingQuotes: [
        { text: 'Call me Ishmael.', chapterTitle: 'Loomings', cfi: 'epubcfi(/6/4!/4/2/1:0)' },
      ],
      spoilerGuard: true,
      shareAnnotations: false,
    });
  });

  it('drops empty selections and quotes queued for another book', () => {
    const payload = buildReaderLivePayload({
      ...base,
      selection: { text: '   ' },
      pendingQuotesBookId: 'other',
    });
    expect(payload.selection).toBeNull();
    expect(payload.pendingQuotes).toEqual([]);
  });
});

describe('MCP client config', () => {
  const info = {
    command: '/Applications/Wellread.app/Contents/MacOS/node',
    args: [
      '/Applications/Wellread.app/Contents/Resources/eve/.output/server/mcpBridge.mjs',
      '--endpoint-file',
      '/Users/me/Library/Application Support/com.wellread.app/eve/mcp-endpoint.json',
    ],
    endpointFile: '',
  };

  it('quotes paths with spaces for the claude mcp add command', () => {
    expect(claudeMcpAddCommand(info)).toBe(
      'claude mcp add --scope user wellread -- /Applications/Wellread.app/Contents/MacOS/node ' +
        '/Applications/Wellread.app/Contents/Resources/eve/.output/server/mcpBridge.mjs ' +
        "--endpoint-file '/Users/me/Library/Application Support/com.wellread.app/eve/mcp-endpoint.json'",
    );
    expect(claudeMcpAddCommand({ ...info, command: "/it's/node" })).toContain(`'/it'\\''s/node'`);
  });

  it('emits an mcpServers entry', () => {
    expect(JSON.parse(mcpServersJson(info))).toEqual({
      mcpServers: { wellread: { command: info.command, args: info.args } },
    });
  });
});
