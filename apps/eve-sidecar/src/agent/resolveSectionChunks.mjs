/**
 * Resolve extract chunk workspace paths for a spine sectionIndex (or chapter title).
 * Runs on the host before the model loop so the agent need not glob the whole tree.
 */

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CFI_COMPARE_MAX_LENGTH,
  collapse as collapseCfi,
  compare as compareCfi,
  parse as parseCfi,
} from './epubcfiCompare.mjs';
import {
  parseExtractChunkFrontmatter,
  projectExtractContentForModel,
} from './extractChunk.mjs';
import { isSafeBookIdSegment } from './notesOkf.mjs';
import {
  chunkWorkspacePath as indexChunkWorkspacePath,
  loadSectionIndex,
  pathsForSectionIndex,
  pathsForTitleIndex,
} from './sectionIndex.mjs';

/** Above this count, envelope warns the model to confirm before reading all. */
export const SECTION_CHUNKS_ASK_THRESHOLD = 64;

/** Cap files visited while scanning one extract (DoS / huge books). */
export const SECTION_CHUNKS_WALK_MAX = 2000;

/** Max focus chunk paths listed in reading_context (a visible page can span several). */
export const FOCUS_CHUNKS_MAX = 4;

/**
 * Spine index encoded in a CFI's first step (`/6/N` → N/2 - 1), matching the
 * reader's progress.index / chunk frontmatter sectionIndex.
 * @param {string} cfi
 * @returns {number | null}
 */
export function spineIndexFromCfi(cfi) {
  if (typeof cfi !== 'string' || !cfi || cfi.length > CFI_COMPARE_MAX_LENGTH) return null;
  try {
    const parsed = parseCfi(cfi);
    const first = (parsed.parent ?? parsed)[0];
    const last = Array.isArray(first) ? first[first.length - 1] : null;
    const index = last && typeof last.index === 'number' ? last.index / 2 - 1 : NaN;
    return Number.isInteger(index) && index >= 0 ? index : null;
  } catch {
    return null;
  }
}

/**
 * Start/end points of a point or range CFI; null when unparsable.
 * @param {string} cfi
 * @returns {{ start: string, end: string } | null}
 */
function cfiBounds(cfi) {
  try {
    return { start: collapseCfi(cfi), end: collapseCfi(cfi, true) };
  } catch {
    return null;
  }
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number | null}
 */
function safeCompareCfi(a, b) {
  try {
    return compareCfi(a, b);
  } catch {
    return null;
  }
}

/** Soft cap for read_section_text output (bytes before UTF-8 decode). */
export const READ_SECTION_TEXT_MAX_BYTES = 256 * 1024;

/** Conservative floor so tiny / misconfigured context windows still get a usable chunk. */
export const MIN_READ_SECTION_TEXT_BYTES = 16 * 1024;

/** Hard ceiling regardless of context window (protects memory / latency). */
export const MAX_READ_SECTION_TEXT_BYTES = 1024 * 1024;

/**
 * Derive a read_section_text byte budget from the active model's context
 * window. Reserves headroom for the system prompt, conversation history,
 * and output so the section text does not monopolize the context.
 *
 * Uses a coarse 3.5 bytes/token average (works for mixed CJK + Latin), and
 * keeps 25% of the window free for everything else.
 *
 * @param {number} contextWindowTokens
 * @returns {number} max bytes for read_section_text
 */
export function contextWindowToMaxReadBytes(contextWindowTokens) {
  const tokens = Number(contextWindowTokens);
  if (!Number.isFinite(tokens) || tokens <= 0) return READ_SECTION_TEXT_MAX_BYTES;
  const usable = tokens * 0.75;
  const bytes = Math.floor(usable * 3.5);
  return Math.min(
    MAX_READ_SECTION_TEXT_BYTES,
    Math.max(MIN_READ_SECTION_TEXT_BYTES, bytes),
  );
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
 * Read and concatenate the full body text of one spine section, sorted by
 * chunkIndex, with chunk frontmatter projected to the compact form used by
 * read_file (cfi/title/endCfi/sectionIndex/chunkIndex + body). Returns a
 * single text blob so the model can answer whole-chapter questions in one
 * tool call instead of hundreds of read_file round-trips.
 *
 * @param {{
 *   booksRoot: string,
 *   bookId: string,
 *   sectionIndex?: number | null,
 *   title?: string | null,
 *   maxBytes?: number,
 *   pathFilter?: (paths: string[]) => { paths: string[], hidden: number },
 * }} input
 * @returns {{
 *   ok: boolean,
 *   text?: string,
 *   sectionIndex?: number,
 *   title?: string,
 *   chunkCount?: number,
 *   via?: 'sectionIndex' | 'title',
 *   truncated?: boolean,
 *   error?: string,
 *   message?: string,
 * }}
 */
export function readSectionText(input) {
  const maxBytes =
    typeof input.maxBytes === 'number' &&
    Number.isFinite(input.maxBytes) &&
    input.maxBytes > 0
      ? Math.floor(input.maxBytes)
      : READ_SECTION_TEXT_MAX_BYTES;
  const booksRoot = input.booksRoot;
  const bookId = input.bookId;
  if (typeof booksRoot !== 'string' || !booksRoot.trim()) {
    return { ok: false, error: 'unavailable', message: 'books root unavailable' };
  }
  if (!isSafeBookIdSegment(bookId)) {
    return { ok: false, error: 'invalid_args', message: 'invalid bookId' };
  }

  const sectionRaw = input.sectionIndex;
  const hasIndex =
    typeof sectionRaw === 'number' &&
    Number.isFinite(sectionRaw) &&
    sectionRaw >= 0;
  const title = typeof input.title === 'string' ? input.title.trim() : '';

  if (!hasIndex && !title) {
    return { ok: false, error: 'invalid_args', message: 'Provide sectionIndex and/or title' };
  }

  /** @type {{ paths: string[], count: number, sectionIndex?: number, title?: string }} */
  let resolved;
  if (hasIndex) {
    const r = resolveSectionChunksByIndex(booksRoot, bookId, sectionRaw);
    resolved = { paths: r.paths, count: r.count, sectionIndex: r.sectionIndex };
  } else {
    const r = resolveSectionChunksByTitle(booksRoot, bookId, title);
    resolved = { paths: r.paths, count: r.count, title: r.title };
  }

  let hiddenBySpoilerGuard = 0;
  if (resolved.count && typeof input.pathFilter === 'function') {
    const filtered = input.pathFilter(resolved.paths);
    hiddenBySpoilerGuard = filtered.hidden;
    resolved = { ...resolved, paths: filtered.paths, count: filtered.paths.length };
    if (!resolved.count) {
      return {
        ok: false,
        error: 'spoiler_guard',
        message:
          "Hidden by spoiler guard: this section is past the reader's current position.",
        hiddenBySpoilerGuard,
        ...(hasIndex ? { sectionIndex: resolved.sectionIndex } : { title: resolved.title }),
      };
    }
  }

  if (!resolved.count) {
    return {
      ok: false,
      error: 'not_found',
      message: hasIndex
        ? `no chunks for sectionIndex ${sectionRaw}`
        : `no chunks for title "${title}"`,
      ...(hasIndex ? { sectionIndex: resolved.sectionIndex } : { title: resolved.title }),
    };
  }

  const chunksDir = chunksHostDir(booksRoot, bookId);
  if (!chunksDir) {
    return { ok: false, error: 'unavailable', message: 'chunks directory unavailable' };
  }

  const parts = [];
  let totalBytes = 0;
  let truncated = false;
  let chunkCount = 0;

  for (const wsPath of resolved.paths) {
    if (totalBytes >= maxBytes) {
      truncated = true;
      break;
    }
    const fileName = wsPath.split('/').pop();
    if (!fileName) continue;
    const full = join(chunksDir, fileName);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile()) continue;
    let raw;
    try {
      raw = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const projected = projectExtractContentForModel(raw);
    if (parts.length > 0) parts.push('');
    parts.push(projected);
    totalBytes += Buffer.byteLength(projected, 'utf8');
    chunkCount += 1;
  }

  if (chunkCount === 0) {
    return {
      ok: false,
      error: 'not_found',
      message: 'no readable chunks',
      ...(hasIndex ? { sectionIndex: resolved.sectionIndex } : { title: resolved.title }),
    };
  }

  return {
    ok: true,
    text: parts.join('\n'),
    chunkCount,
    ...(truncated ? { truncated: true } : {}),
    ...(hiddenBySpoilerGuard ? { hiddenBySpoilerGuard } : {}),
    ...(hasIndex
      ? { sectionIndex: resolved.sectionIndex, via: 'sectionIndex' }
      : { title: resolved.title, via: 'title' }),
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
 * Chunk paths containing a Pending Quote's selection cfi (section derived
 * from the cfi itself when the quote carries no sectionIndex).
 * @param {{ booksRoot: string, bookId: string, cfi: string }} input
 * @returns {string[]}
 */
export function resolveChunksForCfi(input) {
  const sectionIndex = spineIndexFromCfi(input.cfi);
  if (sectionIndex === null) return [];
  const focus = resolveFocusChunks({
    booksRoot: input.booksRoot,
    bookId: input.bookId,
    readerState: { cfi: input.cfi, sectionIndex },
    exact: true,
  });
  return focus?.via === 'cfi' ? focus.paths : [];
}

/**
 * Pick chunk paths for the reader's current CFI (or section midpoint fallback).
 * @param {{
 *   booksRoot: string,
 *   bookId: string,
 *   readerState?: {
 *     chapter?: string | null,
 *     cfi?: string | null,
 *     sectionIndex?: number | null,
 *   } | null,
 *   exact?: boolean, // only chunks overlapping the cfi: no padding, no midpoint fallback
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

  const bounds = cfi ? cfiBounds(cfi) : null;
  if (bounds) {
    // Every chunk overlapping the visible range [start, end] (a page can span
    // several chunks); a single hit also gets the following chunk for context.
    /** @type {number[]} */
    const hits = [];
    rows.forEach((r, i) => {
      if (!r.cfi || !r.endCfi) return;
      const endsAfterStart = safeCompareCfi(r.endCfi, bounds.start);
      const startsBeforeEnd = safeCompareCfi(r.cfi, bounds.end);
      if (endsAfterStart === null || startsBeforeEnd === null) return;
      if (endsAfterStart >= 0 && startsBeforeEnd <= 0) hits.push(i);
    });
    if (hits.length) {
      const paths = hits.slice(0, FOCUS_CHUNKS_MAX).map((i) => rows[i].path);
      const next = rows[hits[hits.length - 1] + 1];
      if (input.exact !== true && hits.length === 1 && next) paths.push(next.path);
      return { paths, count: paths.length, via: 'cfi' };
    }
  }
  if (input.exact === true) {
    return { paths: [], count: 0, via: 'none' };
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
