/**
 * Live reader state for external agents over MCP (Claude Code, …): the
 * sidecar keeps the last push and serves it as get_reading_state /
 * get_selection. Same fields the in-app assistant sends with each turn.
 */

import type { PendingQuoteForTurn } from '@wellread/quote-wire';
import type { BookProgress } from '@/types/book';
import type { McpConnectInfo, ReaderLivePayload, ReaderState } from './eveClient';

/** Reader position as the sidecar expects it (also used per in-app turn). */
export function readerStateFromProgress(
  progress: Pick<BookProgress, 'location' | 'sectionLabel' | 'index'> | null | undefined,
): ReaderState | null {
  if (!progress?.location && !progress?.sectionLabel) return null;
  const sectionIndex =
    typeof progress.index === 'number' && Number.isFinite(progress.index) && progress.index >= 0
      ? Math.floor(progress.index)
      : undefined;
  return {
    ...(progress.sectionLabel ? { chapter: progress.sectionLabel } : {}),
    ...(progress.location ? { cfi: progress.location } : {}),
    ...(sectionIndex !== undefined ? { sectionIndex } : {}),
  };
}

export function buildReaderLivePayload(input: {
  bookId: string;
  bookTitle?: string;
  progress: Pick<BookProgress, 'location' | 'sectionLabel' | 'index'> | null | undefined;
  selection: { text: string; cfi?: string } | null;
  /** Pending Quotes and the book they were queued for. */
  pendingQuotes: PendingQuoteForTurn[];
  pendingQuotesBookId: string | null;
  spoilerGuard: boolean;
  shareAnnotations: boolean;
}): ReaderLivePayload {
  const readerState = readerStateFromProgress(input.progress);
  const chapterTitle = input.progress?.sectionLabel || null;
  const text = input.selection?.text.trim();
  return {
    bookId: input.bookId,
    ...(input.bookTitle ? { bookTitle: input.bookTitle } : {}),
    readerState,
    selection: text
      ? { text, chapterTitle, ...(input.selection?.cfi ? { cfi: input.selection.cfi } : {}) }
      : null,
    pendingQuotes:
      input.pendingQuotesBookId === input.bookId
        ? input.pendingQuotes.map(({ text, chapterTitle, cfi }) => ({
            text,
            chapterTitle: chapterTitle ?? null,
            ...(cfi ? { cfi } : {}),
          }))
        : [],
    spoilerGuard: input.spoilerGuard,
    shareAnnotations: input.shareAnnotations,
  };
}

function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** `claude mcp add` line that registers Wellread for all of the user's projects. */
export function claudeMcpAddCommand(info: McpConnectInfo): string {
  return ['claude', 'mcp', 'add', '--scope', 'user', 'wellread', '--', info.command, ...info.args]
    .map(shellQuote)
    .join(' ');
}

/** `mcpServers` JSON entry for clients configured by file (Claude Desktop, Cursor, …). */
export function mcpServersJson(info: McpConnectInfo): string {
  return JSON.stringify(
    { mcpServers: { wellread: { command: info.command, args: info.args } } },
    null,
    2,
  );
}
