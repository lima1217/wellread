/**
 * Notes package path index for the reading-context envelope (names only).
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { isSafeBookIdSegment } from './notesOkf.mjs';

/** Max note file paths listed in the envelope (names only). */
export const NOTES_INDEX_MAX = 24;

/** Cap filesystem visits while building notes_index (DoS / large OKF trees). */
export const NOTES_INDEX_WALK_MAX = 400;

/**
 * List note .md paths relative to the book notes root (names only, no body).
 * Prefers navigation spine (root index.md, then dir index.md) before content
 * pages so NOTES_INDEX_MAX does not bury the OKF entry points. Walk is capped.
 * @param {string} booksRoot
 * @param {string} bookId
 * @param {number} [max]
 * @returns {string[]}
 */
export function listNotesIndex(booksRoot, bookId, max = NOTES_INDEX_MAX) {
  if (!booksRoot || !isSafeBookIdSegment(bookId)) return [];
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : NOTES_INDEX_MAX;
  const notesBase = resolve(join(booksRoot, '.wellread', 'notes'));
  const root = resolve(join(notesBase, bookId));
  if (root !== notesBase && !root.startsWith(`${notesBase}${sep}`)) return [];
  /** @type {string[]} */
  const spine = [];
  /** @type {string[]} */
  const rest = [];
  const state = { visited: 0, stop: false };
  try {
    walkNotes(root, root, spine, rest, state);
  } catch {
    return [];
  }
  const byName = (a, b) => a.localeCompare(b);
  spine.sort((a, b) => {
    const d = notesIndexRank(a) - notesIndexRank(b);
    return d !== 0 ? d : byName(a, b);
  });
  rest.sort(byName);
  return [...spine, ...rest].slice(0, limit);
}

/** Root spine first, then per-directory index.md, then other pages. */
function notesIndexRank(rel) {
  if (rel === 'index.md') return 0;
  if (rel.endsWith('/index.md')) return 10;
  return 100;
}

/**
 * @param {string} rel posix-relative path under notes root
 */
function isNotesIndexCandidate(rel) {
  if (!rel || rel.startsWith('..') || /[\r\n\u0000]/.test(rel)) return false;
  if (!rel.toLowerCase().endsWith('.md')) return false;
  const parts = rel.split('/');
  if (parts[0] === 'tools') return false;
  if (parts[parts.length - 1] === 'log.md') return false;
  if (parts[parts.length - 1] === 'AGENTS.md') return false;
  return true;
}

/**
 * @param {string} dir
 * @param {string} root
 * @param {string[]} spine
 * @param {string[]} rest
 * @param {{ visited: number, stop: boolean }} state
 */
function walkNotes(dir, root, spine, rest, state) {
  if (state.stop) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    if (state.stop) return;
    if (ent.name.startsWith('.')) continue;
    if (ent.name === 'tools' && ent.isDirectory()) continue;
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      walkNotes(abs, root, spine, rest, state);
      continue;
    }
    if (!ent.isFile()) continue;
    state.visited += 1;
    if (state.visited > NOTES_INDEX_WALK_MAX) {
      state.stop = true;
      return;
    }
    try {
      if (!statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    const rel = relative(root, abs).split('\\').join('/');
    if (!isNotesIndexCandidate(rel)) continue;
    if (notesIndexRank(rel) < 100) spine.push(rel);
    else rest.push(rel);
  }
}
