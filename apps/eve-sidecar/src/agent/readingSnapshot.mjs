/**
 * What the reader is looking at right now, as the model sees it: the
 * `<reading_context>` envelope plus the pieces it is built from. Shared by the
 * in-app turn (prepareTurnContext) and external agents over MCP
 * (server/mcp.mjs), so both get the same position, focus text, quotes,
 * spoiler guard and reader memory.
 */

import { readAnnotationsStatus } from './annotations.mjs';
import { readExtractStatus } from './extractMeta.mjs';
import { readFocusChunkTexts } from './focusText.mjs';
import { listNotesIndex } from './notesIndex.mjs';
import { buildReadingContextEnvelope } from './prompt.mjs';
import { readReaderMemory } from './readerMemory.mjs';
import {
  resolveChunksForCfi,
  resolveFocusChunks,
  resolveSectionChunksForReader,
} from './resolveSectionChunks.mjs';
import { createSpoilerGuard } from './spoilerGuard.mjs';

/**
 * Drop envelope chunk paths the spoiler guard hides (count follows).
 * @template {{ paths: string[], count: number } | null} T
 * @param {T} resolved
 * @param {import('./spoilerGuard.mjs').SpoilerGuard | null} guard
 * @returns {T}
 */
function withVisiblePaths(resolved, guard) {
  if (!resolved || !guard) return resolved;
  const { paths, hidden } = guard.filterPaths(resolved.paths);
  if (!hidden) return resolved;
  return { ...resolved, paths, count: Math.max(0, resolved.count - hidden) };
}

/**
 * @param {{
 *   booksRoot: string, // '' when unavailable: envelope still names the book
 *   bookId: string,
 *   bookTitle?: string | null,
 *   readerState?: { chapter?: string | null, cfi?: string | null, sectionIndex?: number | null } | null,
 *   spoilerGuard?: boolean,
 *   quotes?: Array<{ text: string, chapterTitle?: string | null, cfi?: string }>,
 *   priorSources?: Array<{ cfi: string, title?: string, path?: string }>,
 * }} input
 */
export function buildReadingSnapshot(input) {
  const { booksRoot, bookId, readerState } = input;
  const spoilerGuard = createSpoilerGuard({
    enabled: input.spoilerGuard,
    booksRoot,
    bookId,
    readerState,
  });
  const sectionChunks = withVisiblePaths(
    booksRoot ? resolveSectionChunksForReader({ booksRoot, bookId, readerState }) : null,
    spoilerGuard,
  );
  const focusChunks = withVisiblePaths(
    booksRoot ? resolveFocusChunks({ booksRoot, bookId, readerState }) : null,
    spoilerGuard,
  );
  const focusTexts =
    booksRoot && focusChunks?.paths.length
      ? readFocusChunkTexts({ booksRoot, bookId, paths: focusChunks.paths })
      : [];
  const memory = booksRoot ? readReaderMemory(booksRoot, bookId) : null;
  const annotations = booksRoot ? readAnnotationsStatus(booksRoot, bookId) : null;
  const notesIndex = booksRoot ? listNotesIndex(booksRoot, bookId) : [];
  const extractStatus = booksRoot
    ? readExtractStatus(booksRoot, bookId)
    : { status: 'missing', chunkCount: 0, schemaVersion: null };
  // Selection anchors → the extract chunk(s) that hold each quote.
  const quotes = (input.quotes ?? []).map((q) =>
    q.cfi && booksRoot
      ? { ...q, chunks: resolveChunksForCfi({ booksRoot, bookId, cfi: q.cfi }) }
      : q,
  );
  const envelope = buildReadingContextEnvelope({
    bookId,
    bookTitle: input.bookTitle,
    readerState,
    quotes,
    priorSources: input.priorSources ?? [],
    notesIndex,
    extractStatus,
    focusChunks,
    focusTexts,
    sectionChunks,
    annotations,
    spoilerGuard: spoilerGuard ? { limitCfi: spoilerGuard.limitCfi } : null,
  });
  return {
    envelope,
    spoilerGuard,
    extractStatus,
    focusChunks,
    focusTexts,
    sectionChunks,
    memory,
    quotes,
  };
}
