/**
 * Resolve extract chunk workspace paths for a spine sectionIndex (or chapter title).
 * Runs on the host before the model loop so the agent need not glob the whole tree.
 */

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSafeBookIdSegment } from './notesOkf.mjs';

/** Above this count, envelope warns the model to confirm before reading all. */
export const SECTION_CHUNKS_ASK_THRESHOLD = 20;

/** Cap files visited while scanning one extract (DoS / huge books). */
export const SECTION_CHUNKS_WALK_MAX = 2000;

/**
 * @param {string} block frontmatter body (between --- fences)
 * @param {string} key
 * @returns {string | undefined}
 */
function frontmatterValue(block, key) {
  const m = block.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
}

/**
 * @param {string} raw
 * @returns {{ sectionIndex?: number, chunkIndex?: number, title?: string } | null}
 */
export function parseExtractChunkFrontmatter(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const block = match[1];
  const sectionRaw = frontmatterValue(block, 'sectionIndex');
  const chunkRaw = frontmatterValue(block, 'chunkIndex');
  const titleRaw = frontmatterValue(block, 'title');
  /** @type {{ sectionIndex?: number, chunkIndex?: number, title?: string }} */
  const out = {};
  if (sectionRaw !== undefined) {
    const n = Number(sectionRaw);
    if (Number.isFinite(n) && n >= 0) out.sectionIndex = Math.floor(n);
  }
  if (chunkRaw !== undefined) {
    const n = Number(chunkRaw);
    if (Number.isFinite(n) && n >= 0) out.chunkIndex = Math.floor(n);
  }
  if (titleRaw !== undefined) {
    let title = titleRaw;
    if (title.startsWith('"')) {
      try {
        title = JSON.parse(title);
      } catch {
        title = titleRaw;
      }
    }
    if (typeof title === 'string' && title.trim()) out.title = title.trim();
  }
  if (
    out.sectionIndex === undefined &&
    out.chunkIndex === undefined &&
    out.title === undefined
  ) {
    return null;
  }
  return out;
}

/**
 * @param {string} booksRoot
 * @param {string} bookId
 * @returns {string | null} host path to chunks dir
 */
function chunksHostDir(booksRoot, bookId) {
  if (typeof booksRoot !== 'string' || !booksRoot.trim()) return null;
  if (!isSafeBookIdSegment(bookId)) return null;
  return join(booksRoot, '.wellread', 'extract', bookId, 'chunks');
}

/**
 * @param {string} bookId
 * @param {string} fileName
 */
function chunkWorkspacePath(bookId, fileName) {
  return `/workspace/.wellread/extract/${bookId}/chunks/${fileName}`;
}

/**
 * @param {string} booksRoot
 * @param {string} bookId
 * @param {(meta: { sectionIndex?: number, chunkIndex?: number, title?: string, fileName: string }) => boolean} pred
 * @returns {{ paths: string[], count: number }}
 */
function collectMatchingChunks(booksRoot, bookId, pred) {
  const dir = chunksHostDir(booksRoot, bookId);
  if (!dir) return { paths: [], count: 0 };

  /** @type {Array<{ path: string, chunkIndex: number }>} */
  const matched = [];
  let visited = 0;
  let names;
  try {
    const dirSt = lstatSync(dir);
    if (dirSt.isSymbolicLink() || !dirSt.isDirectory()) {
      return { paths: [], count: 0 };
    }
    names = readdirSync(dir);
  } catch {
    return { paths: [], count: 0 };
  }
  names.sort((a, b) => a.localeCompare(b));

  for (const fileName of names) {
    if (visited >= SECTION_CHUNKS_WALK_MAX) break;
    if (!fileName.endsWith('.md') || fileName.startsWith('.')) continue;
    const full = join(dir, fileName);
    // Match wellreadSearch: never read through symlinks under extract/.
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile()) continue;
    visited += 1;
    let raw;
    try {
      raw = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const meta = parseExtractChunkFrontmatter(raw);
    if (!meta) continue;
    if (!pred({ ...meta, fileName })) continue;
    matched.push({
      path: chunkWorkspacePath(bookId, fileName),
      chunkIndex: meta.chunkIndex ?? Number.MAX_SAFE_INTEGER,
    });
  }

  matched.sort((a, b) => a.chunkIndex - b.chunkIndex || a.path.localeCompare(b.path));
  return { paths: matched.map((m) => m.path), count: matched.length };
}

/**
 * @param {string} booksRoot
 * @param {string} bookId
 * @param {number} sectionIndex
 * @returns {{ paths: string[], count: number, sectionIndex: number }}
 */
export function resolveSectionChunksByIndex(booksRoot, bookId, sectionIndex) {
  if (
    typeof sectionIndex !== 'number' ||
    !Number.isFinite(sectionIndex) ||
    sectionIndex < 0
  ) {
    return { paths: [], count: 0, sectionIndex: -1 };
  }
  const idx = Math.floor(sectionIndex);
  const { paths, count } = collectMatchingChunks(
    booksRoot,
    bookId,
    (meta) => meta.sectionIndex === idx,
  );
  return { paths, count, sectionIndex: idx };
}

/**
 * Exact title match (trimmed) against chunk frontmatter title.
 * Tries case-sensitive first, then case-insensitive if empty.
 * @param {string} booksRoot
 * @param {string} bookId
 * @param {string} title
 * @returns {{ paths: string[], count: number, title: string }}
 */
export function resolveSectionChunksByTitle(booksRoot, bookId, title) {
  const needle = typeof title === 'string' ? title.trim() : '';
  if (!needle) return { paths: [], count: 0, title: '' };
  let { paths, count } = collectMatchingChunks(
    booksRoot,
    bookId,
    (meta) => meta.title === needle,
  );
  if (!count) {
    const lower = needle.toLowerCase();
    ({ paths, count } = collectMatchingChunks(
      booksRoot,
      bookId,
      (meta) => typeof meta.title === 'string' && meta.title.toLowerCase() === lower,
    ));
  }
  return { paths, count, title: needle };
}

/**
 * Tool/query entry: prefer sectionIndex when both are set.
 * @param {{
 *   booksRoot: string,
 *   bookId: string,
 *   sectionIndex?: number | null,
 *   title?: string | null,
 * }} input
 * @returns {{
 *   ok: true,
 *   via: 'sectionIndex' | 'title',
 *   count: number,
 *   paths: string[],
 *   sectionIndex?: number,
 *   title?: string,
 *   askBeforeReadingAll: boolean,
 * } | {
 *   ok: false,
 *   error: string,
 *   message: string,
 *   count: number,
 *   paths: string[],
 * }}
 */
export function resolveSectionQuery(input) {
  const booksRoot = input.booksRoot;
  const bookId = input.bookId;
  if (typeof booksRoot !== 'string' || !booksRoot.trim()) {
    return {
      ok: false,
      error: 'unavailable',
      message: 'books root unavailable',
      count: 0,
      paths: [],
    };
  }
  if (!isSafeBookIdSegment(bookId)) {
    return {
      ok: false,
      error: 'invalid_args',
      message: 'invalid bookId',
      count: 0,
      paths: [],
    };
  }

  const sectionRaw = input.sectionIndex;
  const hasIndex =
    typeof sectionRaw === 'number' &&
    Number.isFinite(sectionRaw) &&
    sectionRaw >= 0;
  const title =
    typeof input.title === 'string' ? input.title.trim() : '';

  if (!hasIndex && !title) {
    return {
      ok: false,
      error: 'invalid_args',
      message: 'Provide sectionIndex and/or title',
      count: 0,
      paths: [],
    };
  }

  if (hasIndex) {
    const resolved = resolveSectionChunksByIndex(booksRoot, bookId, sectionRaw);
    return {
      ok: true,
      via: 'sectionIndex',
      sectionIndex: resolved.sectionIndex,
      count: resolved.count,
      paths: resolved.paths,
      askBeforeReadingAll: resolved.count > SECTION_CHUNKS_ASK_THRESHOLD,
    };
  }

  const resolved = resolveSectionChunksByTitle(booksRoot, bookId, title);
  return {
    ok: true,
    via: 'title',
    title: resolved.title,
    count: resolved.count,
    paths: resolved.paths,
    askBeforeReadingAll: resolved.count > SECTION_CHUNKS_ASK_THRESHOLD,
  };
}

/**
 * Prefer sectionIndex; fall back to chapter title when index is absent.
 * @param {{
 *   booksRoot: string,
 *   bookId: string,
 *   readerState?: { chapter?: string | null, sectionIndex?: number | null } | null,
 * }} input
 * @returns {{
 *   paths: string[],
 *   count: number,
 *   via: 'sectionIndex' | 'title' | null,
 *   sectionIndex?: number,
 *   title?: string,
 * } | null}
 */
export function resolveSectionChunksForReader(input) {
  const booksRoot = input.booksRoot;
  const bookId = input.bookId;
  if (typeof booksRoot !== 'string' || !booksRoot.trim()) return null;
  if (!isSafeBookIdSegment(bookId)) return null;

  const state = input.readerState;
  const sectionRaw = state && typeof state === 'object' ? state.sectionIndex : undefined;
  if (
    typeof sectionRaw === 'number' &&
    Number.isFinite(sectionRaw) &&
    sectionRaw >= 0
  ) {
    const resolved = resolveSectionChunksByIndex(booksRoot, bookId, sectionRaw);
    if (!resolved.count) {
      return {
        paths: [],
        count: 0,
        via: 'sectionIndex',
        sectionIndex: resolved.sectionIndex,
      };
    }
    return {
      paths: resolved.paths,
      count: resolved.count,
      via: 'sectionIndex',
      sectionIndex: resolved.sectionIndex,
    };
  }

  const chapter =
    state && typeof state === 'object' && typeof state.chapter === 'string'
      ? state.chapter.trim()
      : '';
  if (chapter) {
    const resolved = resolveSectionChunksByTitle(booksRoot, bookId, chapter);
    if (!resolved.count) {
      return { paths: [], count: 0, via: 'title', title: resolved.title };
    }
    return {
      paths: resolved.paths,
      count: resolved.count,
      via: 'title',
      title: resolved.title,
    };
  }

  return null;
}
