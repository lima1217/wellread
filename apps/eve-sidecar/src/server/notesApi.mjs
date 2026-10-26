/**
 * Reader-facing access to a book's OKF notes package (written by the note skill).
 * Same path gate as the model's write_file, so the reader can only see and edit
 * what the skill itself may write.
 */

import { realpathSync, rmSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { authorizeOkfNotesWrite } from '../agent/tools.mjs';
import { NOTES_INDEX_WALK_MAX, listNotesIndex } from '../agent/notesIndex.mjs';
import { isSafeBookIdSegment, notesPackageWorkspaceRoot } from '../agent/notesOkf.mjs';
import { createBooksFsSession } from '../books/booksFsSession.mjs';

/** Largest note body accepted on read or write (bytes). */
export const MAX_NOTE_BYTES = 512_000;

/**
 * @param {string} booksRoot
 * @param {unknown} bookId
 * @returns {{ ok: true, files: string[] } | { ok: false, status: number, error: string }}
 */
export function listNotes(booksRoot, bookId) {
  if (!isSafeBookIdSegment(bookId)) return { ok: false, status: 400, error: 'bookId_invalid' };
  return { ok: true, files: listNotesIndex(booksRoot, bookId, NOTES_INDEX_WALK_MAX) };
}

/**
 * @param {unknown} bookId
 * @param {unknown} rel path relative to the package root, e.g. `concepts/x.md`
 */
function gateNotePath(bookId, rel) {
  if (!isSafeBookIdSegment(bookId)) return { ok: false, status: 400, error: 'bookId_invalid' };
  if (typeof rel !== 'string' || !rel.toLowerCase().endsWith('.md')) {
    return { ok: false, status: 400, error: 'path_invalid' };
  }
  const gate = authorizeOkfNotesWrite(`${notesPackageWorkspaceRoot(bookId)}/${rel}`, bookId);
  if (!gate.ok) return { ok: false, status: 400, error: 'path_invalid' };
  return { ok: true, path: gate.path };
}

/**
 * Real host path of an existing page, confined to the book's notes package
 * (a symlinked page must not reach outside it). null: missing; false: escapes.
 * @param {string} booksRoot
 * @param {string} bookId
 * @param {string} rel
 * @returns {string | null | false}
 */
function realNotePath(booksRoot, bookId, rel) {
  const root = join(booksRoot, '.wellread', 'notes', bookId);
  let real;
  try {
    real = realpathSync(join(root, rel));
  } catch {
    return null;
  }
  return real.startsWith(`${realpathSync(root)}${sep}`) ? real : false;
}

/** @param {string | null | false} real */
function mtimeOf(real) {
  return real ? statSync(real).mtimeMs : null;
}

/**
 * @param {string} booksRoot
 * @param {unknown} bookId
 * @param {unknown} rel
 * @returns {Promise<{ ok: true, content: string, mtimeMs: number | null } | { ok: false, status: number, error: string }>}
 */
export async function readNote(booksRoot, bookId, rel) {
  const gate = gateNotePath(bookId, rel);
  if (!gate.ok) return gate;
  const session = createBooksFsSession({ getBooksRoot: () => booksRoot });
  try {
    const bytes = await session.readFile({ path: gate.path, maxBytes: MAX_NOTE_BYTES });
    if (!bytes) return { ok: false, status: 404, error: 'not_found' };
    return {
      ok: true,
      content: new TextDecoder().decode(bytes),
      mtimeMs: mtimeOf(realNotePath(booksRoot, bookId, rel)),
    };
  } catch (err) {
    if (err?.code === 'FILE_TOO_LARGE') return { ok: false, status: 413, error: 'note_too_large' };
    return { ok: false, status: 403, error: 'denied' };
  }
}

/**
 * @param {string} booksRoot
 * @param {unknown} bookId
 * @param {unknown} rel
 * @param {unknown} content
 * @param {unknown} [expectedMtimeMs] mtime from the read the edit started from;
 *   when the page changed since (e.g. the assistant rewrote it), refuse with 409.
 * @returns {Promise<{ ok: true, mtimeMs: number | null } | { ok: false, status: number, error: string }>}
 */
export async function writeNote(booksRoot, bookId, rel, content, expectedMtimeMs) {
  const gate = gateNotePath(bookId, rel);
  if (!gate.ok) return gate;
  if (typeof content !== 'string') return { ok: false, status: 400, error: 'content_required' };
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength > MAX_NOTE_BYTES) return { ok: false, status: 413, error: 'note_too_large' };
  if (
    typeof expectedMtimeMs === 'number' &&
    mtimeOf(realNotePath(booksRoot, bookId, rel)) !== expectedMtimeMs
  ) {
    return { ok: false, status: 409, error: 'note_changed' };
  }
  const session = createBooksFsSession({ getBooksRoot: () => booksRoot });
  try {
    await session.writeFile({ path: gate.path, content: bytes, confineNotesBookId: bookId });
    return { ok: true, mtimeMs: mtimeOf(realNotePath(booksRoot, bookId, rel)) };
  } catch {
    return { ok: false, status: 403, error: 'denied' };
  }
}

/**
 * @param {string} booksRoot
 * @param {unknown} bookId
 * @param {unknown} rel
 * @returns {Promise<{ ok: true } | { ok: false, status: number, error: string }>}
 */
export async function deleteNote(booksRoot, bookId, rel) {
  const gate = gateNotePath(bookId, rel);
  if (!gate.ok) return gate;
  const real = realNotePath(booksRoot, bookId, rel);
  if (real === null) return { ok: false, status: 404, error: 'not_found' };
  if (real === false) return { ok: false, status: 403, error: 'denied' };
  rmSync(real);
  return { ok: true };
}
