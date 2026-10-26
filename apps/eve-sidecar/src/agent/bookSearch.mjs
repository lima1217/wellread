/**
 * search_book: local lexical ranking (BM25) over this book's extract chunks.
 *
 * grep only finds exact phrases; topic questions ("what does the author say
 * about freedom?") need ranked passages even when wording differs. No model
 * or network: CJK runs become unigrams + bigrams, other scripts become
 * lower-cased words. The per-book index lives in memory and rebuilds when the
 * extract's meta.json / chunks directory changes.
 */

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseExtractChunkFrontmatter } from './extractChunk.mjs';
import { isSafeBookIdSegment } from './notesOkf.mjs';
import { chunkWorkspacePath } from './sectionIndex.mjs';

/** Files indexed per book (very large books are indexed up to this many chunks). */
export const BOOK_SEARCH_CHUNKS_MAX = 20_000;
export const BOOK_SEARCH_DEFAULT_LIMIT = 8;
export const BOOK_SEARCH_MAX_LIMIT = 20;
const SNIPPET_CHARS = 240;
const QUERY_MAX_CHARS = 500;
const INDEX_CACHE_MAX_BOOKS = 4;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

const CJK_RE =
  /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/u;

/** Small English/Chinese function-word list; BM25 idf handles the rest. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'is', 'are', 'was',
  'were', 'be', 'it', 'this', 'that', 'what', 'how', 'why', 'does', 'do',
  'with', 'for', 'as', 'at', 'by', 'about', 'from', 'his', 'her', 'their',
  '的', '了', '是', '在', '和', '吗', '呢', '什么', '怎么', '为什么', '这', '那',
]);

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  /** @type {string[]} */
  const out = [];
  const lower = String(text ?? '').toLowerCase();
  for (const match of lower.matchAll(/[\p{L}\p{N}]+/gu)) {
    const run = match[0];
    if (!CJK_RE.test(run)) {
      if (run.length >= 2 && !STOPWORDS.has(run)) out.push(run);
      continue;
    }
    // Mixed runs: split CJK chars from latin pieces.
    let latin = '';
    /** @type {string[]} */
    const cjk = [];
    const flushCjk = () => {
      for (let i = 0; i < cjk.length; i++) {
        if (!STOPWORDS.has(cjk[i])) out.push(cjk[i]);
        if (i + 1 < cjk.length) out.push(cjk[i] + cjk[i + 1]);
      }
      cjk.length = 0;
    };
    for (const ch of run) {
      if (CJK_RE.test(ch)) {
        if (latin.length >= 2 && !STOPWORDS.has(latin)) out.push(latin);
        latin = '';
        cjk.push(ch);
      } else {
        flushCjk();
        latin += ch;
      }
    }
    flushCjk();
    if (latin.length >= 2 && !STOPWORDS.has(latin)) out.push(latin);
  }
  return out;
}

/**
 * @typedef {{
 *   fileName: string,
 *   title?: string,
 *   sectionIndex?: number,
 *   cfi?: string,
 *   body: string,
 *   tf: Map<string, number>,
 *   len: number,
 * }} IndexedChunk
 *
 * @typedef {{ stamp: string, docs: IndexedChunk[], df: Map<string, number>, avgdl: number }} BookIndex
 */

/** @type {Map<string, BookIndex>} */
const indexCache = new Map();

/** Test seam. */
export function clearBookSearchCache() {
  indexCache.clear();
}

/**
 * @param {string} path
 */
function mtimeOf(path) {
  try {
    return String(lstatSync(path).mtimeMs);
  } catch {
    return '-';
  }
}

/**
 * @param {string} booksRoot
 * @param {string} bookId
 * @returns {BookIndex | null}
 */
function loadBookIndex(booksRoot, bookId) {
  const extractRoot = join(booksRoot, '.wellread', 'extract', bookId);
  const chunksDir = join(extractRoot, 'chunks');
  const stamp = `${mtimeOf(join(extractRoot, 'meta.json'))}|${mtimeOf(chunksDir)}`;
  const key = `${booksRoot}\u0000${bookId}`;
  const cached = indexCache.get(key);
  if (cached && cached.stamp === stamp) return cached;

  let names;
  try {
    const st = lstatSync(chunksDir);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    names = readdirSync(chunksDir);
  } catch {
    return null;
  }
  names = names
    .filter((n) => n.endsWith('.md') && !n.startsWith('.'))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, BOOK_SEARCH_CHUNKS_MAX);

  /** @type {IndexedChunk[]} */
  const docs = [];
  /** @type {Map<string, number>} */
  const df = new Map();
  let totalLen = 0;
  for (const fileName of names) {
    const full = join(chunksDir, fileName);
    let raw;
    try {
      const st = lstatSync(full);
      if (st.isSymbolicLink() || !st.isFile()) continue;
      raw = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const meta = parseExtractChunkFrontmatter(raw) ?? {};
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
    const tokens = tokenize(`${meta.title ?? ''}\n${body}`);
    /** @type {Map<string, number>} */
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    totalLen += tokens.length;
    docs.push({
      fileName,
      ...(meta.title ? { title: meta.title } : {}),
      ...(typeof meta.sectionIndex === 'number' ? { sectionIndex: meta.sectionIndex } : {}),
      ...(meta.cfi ? { cfi: meta.cfi } : {}),
      body,
      tf,
      len: tokens.length,
    });
  }
  const index = { stamp, docs, df, avgdl: docs.length ? totalLen / docs.length : 0 };
  indexCache.delete(key);
  indexCache.set(key, index);
  while (indexCache.size > INDEX_CACHE_MAX_BOOKS) {
    const oldest = indexCache.keys().next().value;
    if (oldest === undefined) break;
    indexCache.delete(oldest);
  }
  return index;
}

/**
 * Pick a snippet around the densest cluster of query-term hits.
 * @param {string} body
 * @param {string[]} terms
 */
export function snippetFor(body, terms) {
  const flat = body.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let best = -1;
  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  if (best < 0) best = 0;
  const start = Math.max(0, best - Math.floor(SNIPPET_CHARS / 3));
  const end = Math.min(flat.length, start + SNIPPET_CHARS);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/**
 * @param {{
 *   booksRoot: string,
 *   bookId: string,
 *   query: string,
 *   limit?: number,
 *   sectionIndex?: number,
 *   isPathHidden?: (workspacePath: string) => boolean,
 * }} input
 */
export function searchBook(input) {
  if (typeof input.booksRoot !== 'string' || !input.booksRoot.trim()) {
    return { ok: false, error: 'unavailable', message: 'books root unavailable', hits: [] };
  }
  if (!isSafeBookIdSegment(input.bookId)) {
    return { ok: false, error: 'invalid_args', message: 'invalid bookId', hits: [] };
  }
  const query = String(input.query ?? '').slice(0, QUERY_MAX_CHARS);
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) {
    return { ok: false, error: 'invalid_args', message: 'query has no searchable words', hits: [] };
  }
  const index = loadBookIndex(input.booksRoot, input.bookId);
  if (!index || !index.docs.length) {
    return { ok: false, error: 'not_found', message: 'no extract chunks to search', hits: [] };
  }
  const limitRaw = Number(input.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(BOOK_SEARCH_MAX_LIMIT, Math.max(1, Math.floor(limitRaw)))
    : BOOK_SEARCH_DEFAULT_LIMIT;

  const N = index.docs.length;
  /** @type {Array<{ doc: IndexedChunk, score: number }>} */
  const scored = [];
  let hidden = 0;
  for (const doc of index.docs) {
    if (typeof input.sectionIndex === 'number' && doc.sectionIndex !== input.sectionIndex) {
      continue;
    }
    let score = 0;
    for (const term of terms) {
      const f = doc.tf.get(term);
      if (!f) continue;
      const n = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const norm = 1 - BM25_B + BM25_B * (index.avgdl ? doc.len / index.avgdl : 1);
      score += idf * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * norm));
    }
    if (score <= 0) continue;
    if (input.isPathHidden?.(chunkWorkspacePath(input.bookId, doc.fileName))) {
      hidden += 1;
      continue;
    }
    scored.push({ doc, score });
  }
  scored.sort((a, b) => b.score - a.score || a.doc.fileName.localeCompare(b.doc.fileName));
  const hits = scored.slice(0, limit).map(({ doc, score }) => ({
    path: chunkWorkspacePath(input.bookId, doc.fileName),
    ...(doc.title ? { title: doc.title } : {}),
    ...(doc.sectionIndex !== undefined ? { sectionIndex: doc.sectionIndex } : {}),
    ...(doc.cfi ? { cfi: doc.cfi } : {}),
    score: Math.round(score * 100) / 100,
    snippet: snippetFor(doc.body, terms),
  }));
  return {
    ok: true,
    hits,
    totalMatches: scored.length,
    ...(hidden ? { hiddenBySpoilerGuard: hidden } : {}),
  };
}
