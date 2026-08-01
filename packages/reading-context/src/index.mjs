/**
 * Reading-context envelope field SSOT for Reading Assistant.
 * Host builds readerState; sidecar builds the envelope text from the same keys.
 * Docs: apps/readest-app/docs/reading-assistant-contract.md
 */

/** Default max CFI length accepted in readerState (algo-complexity guard). */
export const READER_STATE_CFI_MAX_LENGTH = 4096;

/** Default max chapter title length in readerState (envelope size guard). */
export const READER_STATE_CHAPTER_MAX_LENGTH = 512;

/**
 * Envelope line keys emitted by buildReadingContextEnvelope (docs + tests lock these).
 * Cross FE–sidecar wire/schema for Reading Assistant must land in packages/.
 */
export const ENVELOPE_KEYS = Object.freeze({
  book: 'book',
  bookId: 'bookId',
  extractStatus: 'extract_status',
  extractChunkCount: 'extract_chunk_count',
  position: 'position',
  chapter: 'chapter',
  cfi: 'cfi',
  sectionIndex: 'sectionIndex',
  focusChunksVia: 'focus_chunks_via',
  focusChunkCount: 'focus_chunk_count',
  focusChunks: 'focus_chunks',
  sectionChunksVia: 'section_chunks_via',
  sectionChunkCount: 'section_chunk_count',
  sectionChunksNote: 'section_chunks_note',
  sectionChunks: 'section_chunks',
  quotes: 'quotes',
  priorSources: 'prior_sources',
  notesIndex: 'notes_index',
});

/**
 * Client-reported reading position fields (host → sidecar readerState).
 * @typedef {{ chapter?: string, cfi?: string, sectionIndex?: number }} ReaderState
 */

/**
 * Normalize optional client reading position for the reading-context envelope.
 * @param {unknown} raw
 * @param {{ cfiMaxLength?: number, chapterMaxLength?: number }} [opts]
 * @returns {ReaderState | null}
 */
export function normalizeReaderState(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const cfiMax =
    typeof opts.cfiMaxLength === 'number' && Number.isFinite(opts.cfiMaxLength)
      ? opts.cfiMaxLength
      : READER_STATE_CFI_MAX_LENGTH;
  const chapterMax =
    typeof opts.chapterMaxLength === 'number' && Number.isFinite(opts.chapterMaxLength)
      ? opts.chapterMaxLength
      : READER_STATE_CHAPTER_MAX_LENGTH;

  const chapterRaw =
    typeof /** @type {{ chapter?: unknown }} */ (raw).chapter === 'string'
      ? /** @type {{ chapter: string }} */ (raw).chapter.trim()
      : '';
  const chapter =
    chapterRaw.length > chapterMax ? chapterRaw.slice(0, chapterMax) : chapterRaw;
  const cfiRaw =
    typeof /** @type {{ cfi?: unknown }} */ (raw).cfi === 'string'
      ? /** @type {{ cfi: string }} */ (raw).cfi.trim()
      : '';
  const cfi = cfiRaw.length <= cfiMax ? cfiRaw : '';
  const sectionRaw = /** @type {{ sectionIndex?: unknown }} */ (raw).sectionIndex;
  const sectionIndex =
    typeof sectionRaw === 'number' &&
    Number.isFinite(sectionRaw) &&
    sectionRaw >= 0
      ? Math.floor(sectionRaw)
      : undefined;
  if (!chapter && !cfi && sectionIndex === undefined) return null;
  return {
    ...(chapter ? { chapter } : {}),
    ...(cfi ? { cfi } : {}),
    ...(sectionIndex !== undefined ? { sectionIndex } : {}),
  };
}
