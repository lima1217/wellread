/**
 * Inline focus-chunk text into <reading_context> so "this page" questions are
 * answered without a read_file round-trip. Only whole chunks that fit the
 * token budget are inlined; the rest stay as paths for read_file.
 *
 * Earlier turns replay a stub instead of the text (compactEnvelopeFocusText),
 * mirroring tool-result replay compaction: same input → same bytes.
 */

import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimateTokens } from './contextCompress.mjs';
import { projectExtractContentForModel } from './extractChunk.mjs';
import { isSafeBookIdSegment } from './notesOkf.mjs';
import { isSafeChunkFileName } from './sectionIndex.mjs';

/** Token budget for all inlined focus chunks of one turn. */
export const FOCUS_TEXT_MAX_TOKENS = 3000;

const FOCUS_TEXT_REPLAY_STUB =
  'focus_text: (omitted from replay; read_file the focus_chunks paths to re-read)';

/**
 * Keep book text from closing our own wrapper tags.
 * @param {string} text
 */
function neutralizeWrapperTags(text) {
  return text.replace(/<\/(focus_chunk|reading_context)>/gi, '<\\/$1>');
}

/**
 * @param {{
 *   booksRoot: string,
 *   bookId: string,
 *   paths: string[],
 *   maxTokens?: number,
 * }} input
 * @returns {Array<{ path: string, content: string }>}
 */
export function readFocusChunkTexts(input) {
  const { booksRoot, bookId } = input;
  if (typeof booksRoot !== 'string' || !booksRoot.trim()) return [];
  if (!isSafeBookIdSegment(bookId) || !Array.isArray(input.paths)) return [];
  const prefix = `/workspace/.wellread/extract/${bookId}/chunks/`;
  const budget =
    Number.isFinite(input.maxTokens) && Number(input.maxTokens) > 0
      ? Number(input.maxTokens)
      : FOCUS_TEXT_MAX_TOKENS;

  /** @type {Array<{ path: string, content: string }>} */
  const out = [];
  let used = 0;
  for (const path of input.paths) {
    if (typeof path !== 'string' || !path.startsWith(prefix)) break;
    const fileName = path.slice(prefix.length);
    if (!isSafeChunkFileName(fileName)) break;
    const full = join(booksRoot, '.wellread', 'extract', bookId, 'chunks', fileName);
    let raw;
    try {
      // Same rule as the other extract readers: never follow symlinks.
      const st = lstatSync(full);
      if (st.isSymbolicLink() || !st.isFile()) break;
      raw = readFileSync(full, 'utf8');
    } catch {
      break;
    }
    const content = neutralizeWrapperTags(projectExtractContentForModel(raw)).trim();
    const cost = estimateTokens(content);
    // Stop at the first chunk that does not fit so inlined text stays contiguous.
    if (used + cost > budget) break;
    used += cost;
    out.push({ path, content });
  }
  return out;
}

/**
 * Envelope lines for inlined focus text (empty when nothing was inlined).
 * @param {string} key envelope key (ENVELOPE_KEYS.focusText)
 * @param {Array<{ path: string, content: string }> | null | undefined} texts
 * @returns {string[]}
 */
export function formatFocusTextLines(key, texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const lines = [
    `${key}: text of the first ${texts.length} focus chunk(s), inlined; cite with each chunk's cfi`,
  ];
  for (const t of texts) {
    lines.push(`<focus_chunk path=${JSON.stringify(t.path)}>`, t.content, '</focus_chunk>');
  }
  return lines;
}

/**
 * Replace inlined focus text in a persisted user turn with a short stub.
 * @param {string} content
 * @returns {string}
 */
export function compactEnvelopeFocusText(content) {
  if (typeof content !== 'string' || !content.includes('<focus_chunk ')) return content;
  return content.replace(
    /^focus_text:[^\n]*\n(?:<focus_chunk [^\n]*>\n[\s\S]*?\n<\/focus_chunk>(?:\n|$))+/m,
    `${FOCUS_TEXT_REPLAY_STUB}\n`,
  );
}
