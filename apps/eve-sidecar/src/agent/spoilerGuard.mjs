/**
 * Spoiler guard: when the reader opts in, extract text past their current
 * position is hidden from every Books tool (read_file, read_section_text,
 * resolve_section, grep, search_book). The limit is the end of the visible
 * range CFI the client reports; chunks starting after it are withheld.
 */

import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSafeChunkFileName } from '@wellread/extract-contract';
import {
  CFI_COMPARE_MAX_LENGTH,
  collapse as collapseCfi,
  compare as compareCfi,
} from './epubcfiCompare.mjs';
import { parseExtractChunkFrontmatter } from './extractChunk.mjs';
import { isSafeBookIdSegment } from './notesOkf.mjs';
import { loadSectionIndex } from './sectionIndex.mjs';

export const SPOILER_GUARD_MESSAGE =
  'Hidden by spoiler guard: this passage is past the reader\'s current position. Answer from what they have read so far and say later content is hidden.';

/**
 * @typedef {{
 *   limitCfi: string,
 *   isPathHidden: (workspacePath: string) => boolean,
 *   filterPaths: (paths: string[]) => { paths: string[], hidden: number },
 * }} SpoilerGuard
 */

/**
 * @param {string} bookId
 */
function extractChunksPrefix(bookId) {
  return `/workspace/.wellread/extract/${bookId}/chunks/`;
}

/**
 * Build a guard for one turn, or null when disabled / no usable position.
 *
 * @param {{
 *   enabled?: boolean,
 *   booksRoot: string,
 *   bookId: string,
 *   readerState?: { cfi?: string | null } | null,
 * }} input
 * @returns {SpoilerGuard | null}
 */
export function createSpoilerGuard(input) {
  if (input.enabled !== true) return null;
  if (!isSafeBookIdSegment(input.bookId)) return null;
  const raw = typeof input.readerState?.cfi === 'string' ? input.readerState.cfi.trim() : '';
  if (!raw || raw.length > CFI_COMPARE_MAX_LENGTH) return null;
  let limitCfi;
  try {
    // A visible range counts as read up to its end.
    limitCfi = collapseCfi(raw, true);
  } catch {
    return null;
  }

  const prefix = extractChunksPrefix(input.bookId);
  /** @type {Map<string, string>} fileName → chunk start cfi */
  const startCfiByFile = new Map();
  const index = input.booksRoot ? loadSectionIndex(input.booksRoot, input.bookId) : null;
  if (index) {
    for (const rows of Object.values(index.sections)) {
      for (const row of rows) {
        if (row.cfi) startCfiByFile.set(row.fileName, row.cfi);
      }
    }
  }

  /** @type {Map<string, boolean>} */
  const verdicts = new Map();

  /**
   * @param {string} fileName
   * @returns {string}
   */
  function startCfiFor(fileName) {
    const known = startCfiByFile.get(fileName);
    if (known !== undefined) return known;
    // Legacy extract without an index: read the chunk frontmatter once.
    let cfi = '';
    try {
      const full = join(input.booksRoot, '.wellread', 'extract', input.bookId, 'chunks', fileName);
      const st = lstatSync(full);
      if (!st.isSymbolicLink() && st.isFile()) {
        cfi = parseExtractChunkFrontmatter(readFileSync(full, 'utf8'))?.cfi ?? '';
      }
    } catch {
      cfi = '';
    }
    startCfiByFile.set(fileName, cfi);
    return cfi;
  }

  /** @param {string} workspacePath */
  function isPathHidden(workspacePath) {
    if (typeof workspacePath !== 'string' || !workspacePath.startsWith(prefix)) return false;
    const fileName = workspacePath.slice(prefix.length);
    if (!isSafeChunkFileName(fileName)) return false;
    const cached = verdicts.get(fileName);
    if (cached !== undefined) return cached;
    const start = startCfiFor(fileName);
    let hidden = false;
    if (start && start.length <= CFI_COMPARE_MAX_LENGTH) {
      try {
        hidden = compareCfi(start, limitCfi) > 0;
      } catch {
        hidden = false;
      }
    }
    verdicts.set(fileName, hidden);
    return hidden;
  }

  return {
    limitCfi,
    isPathHidden,
    filterPaths(paths) {
      const visible = paths.filter((p) => !isPathHidden(p));
      return { paths: visible, hidden: paths.length - visible.length };
    },
  };
}
