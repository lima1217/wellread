/**
 * Reader annotations export: the host writes the current book's highlights,
 * notes and bookmarks to `Books/.wellread/annotations/<bookId>.md` (one
 * `### ` block per item) before each turn. The model reads it on demand;
 * the envelope only advertises its path and item count.
 */

import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSafeBookIdSegment } from './notesOkf.mjs';

/** Skip counting absurdly large exports (count is advisory only). */
const ANNOTATIONS_COUNT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * @param {string} bookId
 */
export function annotationsWorkspacePath(bookId) {
  return `/workspace/.wellread/annotations/${bookId}.md`;
}

/**
 * @param {string} booksRoot
 * @param {string} bookId
 * @returns {{ path: string, count: number } | null} null when absent / empty
 */
export function readAnnotationsStatus(booksRoot, bookId) {
  if (typeof booksRoot !== 'string' || !booksRoot.trim()) return null;
  if (!isSafeBookIdSegment(bookId)) return null;
  const host = join(booksRoot, '.wellread', 'annotations', `${bookId}.md`);
  let st;
  try {
    st = lstatSync(host);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile() || st.size === 0) return null;
  if (st.size > ANNOTATIONS_COUNT_MAX_BYTES) {
    return { path: annotationsWorkspacePath(bookId), count: -1 };
  }
  let raw;
  try {
    raw = readFileSync(host, 'utf8');
  } catch {
    return null;
  }
  const count = raw.split(/\r?\n/).filter((line) => line.startsWith('### ')).length;
  if (count === 0) return null;
  return { path: annotationsWorkspacePath(bookId), count };
}
