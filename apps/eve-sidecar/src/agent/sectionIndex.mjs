/**
 * Load host-written `section-index.json` for O(section) resolve without scanning chunks/.
 */

import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSafeChunkFileName } from '@wellread/extract-contract';
import { extractHostRoot } from './extractMeta.mjs';
import { isSafeBookIdSegment } from './notesOkf.mjs';

export { isSafeChunkFileName } from '@wellread/extract-contract';

/**
 * @typedef {import('@wellread/extract-contract').SectionIndexChunk} SectionIndexChunk
 * @typedef {import('@wellread/extract-contract').SectionIndexFile} SectionIndexFile
 */

/**
 * @param {string} bookId
 * @param {string} fileName
 */
export function chunkWorkspacePath(bookId, fileName) {
  return `/workspace/.wellread/extract/${bookId}/chunks/${fileName}`;
}

/**
 * @param {string} booksRoot
 * @param {string} bookId
 * @returns {SectionIndexFile | null}
 */
export function loadSectionIndex(booksRoot, bookId) {
  const root = extractHostRoot(booksRoot, bookId);
  if (!root || !isSafeBookIdSegment(bookId)) return null;
  const path = join(root, 'section-index.json');
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile()) return null;
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || typeof v.sections !== 'object' || !v.sections) {
      return null;
    }
    /** @type {Record<string, SectionIndexChunk[]>} */
    const sections = {};
    for (const [key, rows] of Object.entries(v.sections)) {
      if (!Array.isArray(rows)) continue;
      const cleaned = [];
      for (const row of rows) {
        if (!row || typeof row.fileName !== 'string' || !isSafeChunkFileName(row.fileName)) {
          continue;
        }
        cleaned.push({
          fileName: row.fileName.trim(),
          chunkIndex:
            typeof row.chunkIndex === 'number' && Number.isFinite(row.chunkIndex)
              ? Math.floor(row.chunkIndex)
              : Number.MAX_SAFE_INTEGER,
          sectionIndex:
            typeof row.sectionIndex === 'number' && Number.isFinite(row.sectionIndex)
              ? Math.floor(row.sectionIndex)
              : Number(key),
          title: typeof row.title === 'string' ? row.title : null,
          cfi: typeof row.cfi === 'string' ? row.cfi : '',
          endCfi: typeof row.endCfi === 'string' ? row.endCfi : '',
        });
      }
      cleaned.sort(
        (a, b) => a.chunkIndex - b.chunkIndex || a.fileName.localeCompare(b.fileName),
      );
      if (cleaned.length) sections[key] = cleaned;
    }
    /** @type {Record<string, number[]>} */
    const titles = {};
    if (v.titles && typeof v.titles === 'object') {
      for (const [title, idxs] of Object.entries(v.titles)) {
        if (!Array.isArray(idxs)) continue;
        const nums = idxs
          .filter((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
          .map((n) => Math.floor(n));
        if (nums.length) titles[title] = nums;
      }
    }
    return {
      schemaVersion: typeof v.schemaVersion === 'number' ? v.schemaVersion : 0,
      sections,
      titles,
    };
  } catch {
    return null;
  }
}

/**
 * @param {SectionIndexFile} index
 * @param {string} bookId
 * @param {number} sectionIndex
 * @returns {{ paths: string[], count: number, rows: SectionIndexChunk[], fromIndex: true }}
 */
export function pathsForSectionIndex(index, bookId, sectionIndex) {
  const rows = index.sections[String(sectionIndex)] ?? [];
  const paths = rows.map((r) => chunkWorkspacePath(bookId, r.fileName));
  return { paths, count: paths.length, rows, fromIndex: true };
}

/**
 * @param {SectionIndexFile} index
 * @param {string} bookId
 * @param {string} title
 * @returns {{ paths: string[], count: number, rows: SectionIndexChunk[], fromIndex: true } | null}
 */
export function pathsForTitleIndex(index, bookId, title) {
  const needle = title.trim();
  if (!needle) return null;
  const lower = needle.toLowerCase();
  let sectionIndexes = index.titles[lower];
  if (!sectionIndexes?.length) {
    // Rebuild from rows when titles map missing (partial index).
    /** @type {Set<number>} */
    const found = new Set();
    for (const rows of Object.values(index.sections)) {
      for (const row of rows) {
        const t = (row.title ?? '').trim();
        if (t === needle || t.toLowerCase() === lower) found.add(row.sectionIndex);
      }
    }
    sectionIndexes = [...found];
  }
  if (!sectionIndexes.length) return null;
  /** @type {SectionIndexChunk[]} */
  const rows = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const si of sectionIndexes) {
    for (const row of index.sections[String(si)] ?? []) {
      if (seen.has(row.fileName)) continue;
      seen.add(row.fileName);
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.chunkIndex - b.chunkIndex || a.fileName.localeCompare(b.fileName));
  const paths = rows.map((r) => chunkWorkspacePath(bookId, r.fileName));
  return { paths, count: paths.length, rows, fromIndex: true };
}
