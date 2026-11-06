/**
 * Live reader state the desktop host pushes while a book is open
 * (PUT /eve/v1/reader/live). External agents read it over MCP: the in-app
 * assistant gets the same fields per turn in the POST /turns body.
 */

import { isSafeBookIdSegment } from '../agent/notesOkf.mjs';
import { normalizeReaderState } from '../agent/prompt.mjs';

const QUOTE_TEXT_MAX = 8000;
const QUOTES_MAX = 20;

/**
 * @typedef {{ text: string, chapterTitle?: string, cfi?: string }} LiveQuote
 * @typedef {{
 *   bookId: string,
 *   bookTitle?: string,
 *   readerState: { chapter?: string, cfi?: string, sectionIndex?: number } | null,
 *   selection: LiveQuote | null,
 *   pendingQuotes: LiveQuote[],
 *   spoilerGuard: boolean,
 *   shareAnnotations: boolean,
 *   updatedAt: number,
 * }} ReaderLiveState
 */

/** @returns {LiveQuote | null} */
function normalizeQuote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, QUOTE_TEXT_MAX) : '';
  if (!text) return null;
  const chapterTitle = typeof raw.chapterTitle === 'string' ? raw.chapterTitle.trim() : '';
  const cfi = typeof raw.cfi === 'string' ? raw.cfi.trim() : '';
  return {
    text,
    ...(chapterTitle ? { chapterTitle } : {}),
    ...(cfi ? { cfi } : {}),
  };
}

/**
 * @param {unknown} body
 * @returns {ReaderLiveState | null} null when bookId is missing or unsafe
 */
export function normalizeReaderLive(body) {
  if (!body || typeof body !== 'object') return null;
  const b = /** @type {Record<string, unknown>} */ (body);
  if (typeof b.bookId !== 'string' || !isSafeBookIdSegment(b.bookId)) return null;
  const bookTitle = typeof b.bookTitle === 'string' ? b.bookTitle.trim() : '';
  return {
    bookId: b.bookId,
    ...(bookTitle ? { bookTitle } : {}),
    readerState: normalizeReaderState(b.readerState),
    selection: normalizeQuote(b.selection),
    pendingQuotes: (Array.isArray(b.pendingQuotes) ? b.pendingQuotes : [])
      .map(normalizeQuote)
      .filter((q) => q !== null)
      .slice(0, QUOTES_MAX),
    spoilerGuard: b.spoilerGuard === true,
    // Absent means shared (default on), same as the turn body.
    shareAnnotations: b.shareAnnotations !== false,
    updatedAt: Date.now(),
  };
}

/** Last pushed state wins (the focused reader window pushes last). */
export function createReaderLiveStore() {
  /** @type {ReaderLiveState | null} */
  let current = null;
  return {
    get: () => current,
    /** @param {ReaderLiveState} state */
    set: (state) => {
      current = state;
    },
    /** Clear only when the closing book is still the live one. */
    clear: (bookId) => {
      if (!bookId || current?.bookId === bookId) current = null;
    },
  };
}
