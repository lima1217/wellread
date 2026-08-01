/**
 * Resolve extract chunk workspace paths for a spine sectionIndex (or chapter title).
 * Runs on the host before the model loop so the agent need not glob the whole tree.
 */

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CFI_COMPARE_MAX_LENGTH, cfiInRange } from './epubcfiCompare.mjs';
import { isSafeBookIdSegment } from './notesOkf.mjs';
import {
  chunkWorkspacePath as indexChunkWorkspacePath,
  loadSectionIndex,
  pathsForSectionIndex,
  pathsForTitleIndex,
} from './sectionIndex.mjs';

/** Above this count, envelope warns the model to confirm before reading all. */
export const SECTION_CHUNKS_ASK_THRESHOLD = 20;

/** Cap files visited while scanning one extract (DoS / huge books). */
export const SECTION_CHUNKS_WALK_MAX = 2000;

/** Max focus chunk paths listed in reading_context. */
export const FOCUS_CHUNKS_MAX = 2;

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
 * @param {string} rawJsonish
 * @returns {string}
 */
function parseFrontmatterString(rawJsonish) {
  let title = rawJsonish;
  if (title.startsWith('"')) {
    try {
      title = JSON.parse(title);
    } catch {
      title = rawJsonish;
    }
  }
  return typeof title === 'string' ? title.trim() : '';
}

/**
 * @param {string} raw
 * @returns {{
 *   sectionIndex?: number,
 *   chunkIndex?: number,
 *   title?: string,
 *   cfi?: string,
 *   endCfi?: string,
 * } | null}
 */
export function parseExtractChunkFrontmatter(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const block = match[1];
  const sectionRaw = frontmatterValue(block, 'sectionIndex');
  const chunkRaw = frontmatterValue(block, 'chunkIndex');
  const titleRaw = frontmatterValue(block, 'title');
  const cfiRaw = frontmatterValue(block, 'cfi');
  const endCfiRaw = frontmatterValue(block, 'endCfi');
  /** @type {{
   *   sectionIndex?: number,
   *   chunkIndex?: number,
   *   title?: string,
   *   cfi?: string,
   *   endCfi?: string,
   * }} */
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
    const title = parseFrontmatterString(titleRaw);
    if (title) out.title = title;
  }
  if (cfiRaw !== undefined) {
    const cfi = parseFrontmatterString(cfiRaw);
    if (cfi) out.cfi = cfi;
  }
  if (endCfiRaw !== undefined) {
    const endCfi = parseFrontmatterString(endCfiRaw);
    if (endCfi) out.endCfi = endCfi;
  }
  if (
    out.sectionIndex === undefined &&
    out.chunkIndex === undefined &&
    out.title === undefined &&
    out.cfi === undefined
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
  return indexChunkWorkspacePath(bookId, fileName);
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
    return { paths: [], count: 0, sectionIndex: -1, fromIndex: false };
  }
  const idx = Math.floor(sectionIndex);
  const index = loadSectionIndex(booksRoot, bookId);
  if (index) {
    const hit = pathsForSectionIndex(index, bookId, idx);
    return {
      paths: hit.paths,
      count: hit.count,
      sectionIndex: idx,
      fromIndex: true,
      rows: hit.rows,
    };
  }
  const { paths, count } = collectMatchingChunks(
    booksRoot,
    bookId,
    (meta) => meta.sectionIndex === idx,
  );
  return { paths, count, sectionIndex: idx, fromIndex: false };
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
  if (!needle) return { paths: [], count: 0, title: '', fromIndex: false };
  const index = loadSectionIndex(booksRoot, bookId);
  if (index) {
    const hit = pathsForTitleIndex(index, bookId, needle);
    if (hit) {
      return {
        paths: hit.paths,
        count: hit.count,
        title: needle,
        fromIndex: true,
        rows: hit.rows,
      };
    }
    return { paths: [], count: 0, title: needle, fromIndex: true, rows: [] };
  }
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
  return { paths, count, title: needle, fromIndex: false };
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

/**
 * Pick 1–2 chunk paths for the reader's current CFI (or section midpoint fallback).
 * @param {{
 *   booksRoot: string,
 *   bookId: string,
 *   readerState?: {
 *     chapter?: string | null,
 *     cfi?: string | null,
 *     sectionIndex?: number | null,
 *   } | null,
 * }} input
 * @returns {{
 *   paths: string[],
 *   count: number,
 *   via: 'cfi' | 'section_mid' | 'none',
 * } | null}
 */
export function resolveFocusChunks(input) {
  const booksRoot = input.booksRoot;
  const bookId = input.bookId;
  if (typeof booksRoot !== 'string' || !booksRoot.trim()) return null;
  if (!isSafeBookIdSegment(bookId)) return null;

  const state = input.readerState;
  if (!state || typeof state !== 'object') return null;

  const sectionRaw = state.sectionIndex;
  const hasSection =
    typeof sectionRaw === 'number' && Number.isFinite(sectionRaw) && sectionRaw >= 0;
  const cfiRaw = typeof state.cfi === 'string' ? state.cfi.trim() : '';
  const cfi = cfiRaw.length <= CFI_COMPARE_MAX_LENGTH ? cfiRaw : '';

  if (!hasSection && !cfi && !(typeof state.chapter === 'string' && state.chapter.trim())) {
    return null;
  }

  /** @type {{ fileName: string, chunkIndex: number, cfi: string, endCfi: string, path: string }[]} */
  let rows = [];
  if (hasSection) {
    const resolved = resolveSectionChunksByIndex(booksRoot, bookId, sectionRaw);
    if (resolved.rows?.length) {
      rows = resolved.rows.map((r) => ({
        fileName: r.fileName,
        chunkIndex: r.chunkIndex,
        cfi: r.cfi,
        endCfi: r.endCfi,
        path: chunkWorkspacePath(bookId, r.fileName),
      }));
    } else if (resolved.paths.length) {
      rows = resolved.paths.map((path, i) => ({
        fileName: path.split('/').pop() ?? '',
        chunkIndex: i,
        cfi: '',
        endCfi: '',
        path,
      }));
    }
  } else if (typeof state.chapter === 'string' && state.chapter.trim()) {
    const resolved = resolveSectionChunksByTitle(booksRoot, bookId, state.chapter.trim());
    if (resolved.rows?.length) {
      rows = resolved.rows.map((r) => ({
        fileName: r.fileName,
        chunkIndex: r.chunkIndex,
        cfi: r.cfi,
        endCfi: r.endCfi,
        path: chunkWorkspacePath(bookId, r.fileName),
      }));
    } else {
      rows = resolved.paths.map((path, i) => ({
        fileName: path.split('/').pop() ?? '',
        chunkIndex: i,
        cfi: '',
        endCfi: '',
        path,
      }));
    }
  }

  if (!rows.length) {
    return { paths: [], count: 0, via: 'none' };
  }

  if (cfi) {
    const hitIdx = rows.findIndex(
      (r) => r.cfi && r.endCfi && cfiInRange(cfi, r.cfi, r.endCfi),
    );
    if (hitIdx >= 0) {
      const paths = [rows[hitIdx].path];
      const next = rows[hitIdx + 1];
      if (next && paths.length < FOCUS_CHUNKS_MAX) paths.push(next.path);
      return { paths, count: paths.length, via: 'cfi' };
    }
  }

  // Mid-section fallback (plan: when CFI range match fails).
  const mid = Math.floor((rows.length - 1) / 2);
  const paths = [rows[mid].path];
  if (rows[mid + 1] && paths.length < FOCUS_CHUNKS_MAX) {
    paths.push(rows[mid + 1].path);
  } else if (rows[mid - 1] && paths.length < FOCUS_CHUNKS_MAX) {
    paths.unshift(rows[mid - 1].path);
  }
  return { paths, count: paths.length, via: 'section_mid' };
}
