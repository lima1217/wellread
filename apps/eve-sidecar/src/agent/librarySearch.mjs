/**
 * search_library: BM25 over what the reader wrote about OTHER books in the
 * library: OKF notes packages, exported annotations and book memories.
 *
 * Other books' extract text is never searched: the reader may not have read
 * that far, and their own notes are what "how does this relate to what I
 * read" needs. cfi values are stripped from results because they point into
 * the other book, not the one open in the reader.
 */

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { snippetFor, tokenize } from './bookSearch.mjs';
import { stripCfis } from './citationGuard.mjs';
import { isSafeBookIdSegment } from './notesOkf.mjs';

export const LIBRARY_SEARCH_DEFAULT_LIMIT = 8;
export const LIBRARY_SEARCH_MAX_LIMIT = 20;
/** Files read per call across all books (walk stops after this many). */
export const LIBRARY_FILES_MAX = 2000;
/** Bytes read per file; the rest of a huge hand-written file is ignored. */
const LIBRARY_FILE_MAX_BYTES = 64 * 1024;
const QUERY_MAX_CHARS = 500;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * @typedef {'note' | 'annotation' | 'memory'} LibraryDocKind
 * @typedef {{
 *   bookId: string,
 *   kind: LibraryDocKind,
 *   path: string,
 *   heading?: string,
 *   body: string,
 *   tf: Map<string, number>,
 *   len: number,
 * }} LibraryDoc
 */

/** @type {Map<string, { stamp: string, docs: LibraryDoc[], title?: string }>} host path → parsed docs */
const fileCache = new Map();

/** Test seam. */
export function clearLibrarySearchCache() {
  fileCache.clear();
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listDir(dir) {
  try {
    const st = lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) return [];
    return readdirSync(dir).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * @param {string} full
 * @returns {{ raw: string, stamp: string } | null}
 */
function readSmallFile(full) {
  try {
    const st = lstatSync(full);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const stamp = `${st.mtimeMs}|${st.size}`;
    const raw = readFileSync(full, 'utf8').slice(0, LIBRARY_FILE_MAX_BYTES);
    return { raw, stamp };
  } catch {
    return null;
  }
}

/**
 * @param {string} text
 * @returns {{ tf: Map<string, number>, len: number }}
 */
function termFreq(text) {
  const tokens = tokenize(text);
  /** @type {Map<string, number>} */
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return { tf, len: tokens.length };
}

/**
 * Split a file into searchable docs and pull a book title when it names one.
 * @param {LibraryDocKind} kind
 * @param {string} raw
 * @param {{ bookId: string, path: string }} at
 * @returns {{ docs: LibraryDoc[], title?: string }}
 */
function parseLibraryFile(kind, raw, at) {
  const text = stripCfis(raw.replace(/<!--[\s\S]*?-->/g, ''));
  /** @type {LibraryDoc[]} */
  const docs = [];
  let title;
  if (kind === 'annotation') {
    title = text.match(/^# Reader annotations:\s*(.+)$/m)?.[1]?.trim();
    // One doc per "### " block so a hit lands on a single highlight.
    for (const block of text.split(/^(?=### )/m)) {
      if (!block.startsWith('### ')) continue;
      const heading = block.match(/^### (.+)$/m)?.[1]?.trim();
      const body = block.replace(/^### .+$/m, '').trim();
      if (!body) continue;
      docs.push({ bookId: at.bookId, kind, path: at.path, ...(heading ? { heading } : {}), body, ...termFreq(`${heading ?? ''}\n${body}`) });
    }
    return { docs, ...(title ? { title } : {}) };
  }
  if (kind === 'memory') {
    title = text.match(/^# Book memory:\s*(.+)$/m)?.[1]?.trim();
  }
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const fmTitle = frontmatter.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  if (!body) return { docs, ...(title ? { title } : {}) };
  const heading = fmTitle?.trim() || body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  docs.push({ bookId: at.bookId, kind, path: at.path, ...(heading ? { heading } : {}), body, ...termFreq(`${heading ?? ''}\n${body}`) });
  return { docs, ...(title ? { title } : {}) };
}

/**
 * @param {LibraryDocKind} kind
 * @param {string} full
 * @param {{ bookId: string, path: string }} at
 */
function loadFile(kind, full, at) {
  const file = readSmallFile(full);
  if (!file) return null;
  const cached = fileCache.get(full);
  if (cached && cached.stamp === file.stamp) return cached;
  const parsed = { stamp: file.stamp, ...parseLibraryFile(kind, file.raw, at) };
  fileCache.set(full, parsed);
  return parsed;
}

/**
 * Collect docs for every book except the current one.
 * @param {{ booksRoot: string, bookId: string, includeAnnotations: boolean }} input
 * @returns {{ docs: LibraryDoc[], titles: Map<string, string>, books: Set<string> }}
 */
function collectLibraryDocs(input) {
  const wellread = join(input.booksRoot, '.wellread');
  /** @type {LibraryDoc[]} */
  const docs = [];
  /** @type {Map<string, string>} */
  const titles = new Map();
  /** @type {Set<string>} */
  const books = new Set();
  let files = 0;
  const seen = new Set();

  /**
   * @param {LibraryDocKind} kind
   * @param {string} full
   * @param {string} bookId
   * @param {string} path
   */
  const add = (kind, full, bookId, path) => {
    if (files >= LIBRARY_FILES_MAX) return;
    files += 1;
    const parsed = loadFile(kind, full, { bookId, path });
    if (!parsed) return;
    seen.add(full);
    if (parsed.title && !titles.has(bookId)) titles.set(bookId, parsed.title);
    if (parsed.docs.length) books.add(bookId);
    docs.push(...parsed.docs);
  };

  const notesRoot = join(wellread, 'notes');
  for (const bookId of listDir(notesRoot)) {
    if (bookId === input.bookId || !isSafeBookIdSegment(bookId)) continue;
    /** @param {string} rel */
    const walk = (rel) => {
      for (const name of listDir(join(notesRoot, bookId, rel))) {
        if (files >= LIBRARY_FILES_MAX) return;
        if (name.startsWith('.')) continue;
        const relPath = rel ? `${rel}/${name}` : name;
        // tools/ and AGENTS.md are skill-bundled scaffolding, not reader notes.
        if (relPath === 'tools' || relPath === 'AGENTS.md') continue;
        const full = join(notesRoot, bookId, relPath);
        let st;
        try {
          st = lstatSync(full);
        } catch {
          continue;
        }
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) {
          if (!rel) walk(relPath);
          continue;
        }
        if (!name.endsWith('.md')) continue;
        add('note', full, bookId, `/workspace/.wellread/notes/${bookId}/${relPath}`);
      }
    };
    walk('');
  }

  for (const name of listDir(join(wellread, 'memory', 'books'))) {
    const bookId = name.replace(/\.md$/, '');
    if (!name.endsWith('.md') || bookId === input.bookId || !isSafeBookIdSegment(bookId)) continue;
    add('memory', join(wellread, 'memory', 'books', name), bookId, `/workspace/.wellread/memory/books/${name}`);
  }

  if (input.includeAnnotations) {
    for (const name of listDir(join(wellread, 'annotations'))) {
      const bookId = name.replace(/\.md$/, '');
      if (!name.endsWith('.md') || bookId === input.bookId || !isSafeBookIdSegment(bookId)) continue;
      add('annotation', join(wellread, 'annotations', name), bookId, `/workspace/.wellread/annotations/${name}`);
    }
  }

  // Forget files that disappeared so the cache cannot grow without bound.
  for (const key of fileCache.keys()) {
    if (key.startsWith(wellread) && !seen.has(key)) fileCache.delete(key);
  }
  return { docs, titles, books };
}

/**
 * @param {{
 *   booksRoot: string,
 *   bookId: string,
 *   query: string,
 *   limit?: number,
 *   includeAnnotations?: boolean,
 * }} input
 */
export function searchLibrary(input) {
  if (typeof input.booksRoot !== 'string' || !input.booksRoot.trim()) {
    return { ok: false, error: 'unavailable', message: 'books root unavailable', hits: [] };
  }
  if (!isSafeBookIdSegment(input.bookId)) {
    return { ok: false, error: 'invalid_args', message: 'invalid bookId', hits: [] };
  }
  const terms = [...new Set(tokenize(String(input.query ?? '').slice(0, QUERY_MAX_CHARS)))];
  if (!terms.length) {
    return { ok: false, error: 'invalid_args', message: 'query has no searchable words', hits: [] };
  }
  const limitRaw = Number(input.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(LIBRARY_SEARCH_MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : LIBRARY_SEARCH_DEFAULT_LIMIT;

  const { docs, titles, books } = collectLibraryDocs({
    booksRoot: input.booksRoot,
    bookId: input.bookId,
    includeAnnotations: input.includeAnnotations !== false,
  });
  if (!docs.length) {
    return {
      ok: false,
      error: 'not_found',
      message: 'no notes, annotations or memories saved for other books yet',
      hits: [],
    };
  }

  /** @type {Map<string, number>} */
  const df = new Map();
  let totalLen = 0;
  for (const doc of docs) {
    totalLen += doc.len;
    for (const t of doc.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = docs.length;
  const avgdl = totalLen / N;
  /** @type {Array<{ doc: LibraryDoc, score: number }>} */
  const scored = [];
  for (const doc of docs) {
    let score = 0;
    for (const term of terms) {
      const f = doc.tf.get(term);
      if (!f) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const norm = 1 - BM25_B + BM25_B * (avgdl ? doc.len / avgdl : 1);
      score += idf * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * norm));
    }
    if (score > 0) scored.push({ doc, score });
  }
  scored.sort((a, b) => b.score - a.score || a.doc.path.localeCompare(b.doc.path));
  const hits = scored.slice(0, limit).map(({ doc, score }) => {
    const bookTitle = titles.get(doc.bookId);
    return {
      bookId: doc.bookId,
      ...(bookTitle ? { bookTitle } : {}),
      kind: doc.kind,
      path: doc.path,
      ...(doc.heading ? { heading: doc.heading } : {}),
      score: Math.round(score * 100) / 100,
      snippet: snippetFor(doc.body, terms),
    };
  });
  return { ok: true, hits, totalMatches: scored.length, booksSearched: books.size };
}
