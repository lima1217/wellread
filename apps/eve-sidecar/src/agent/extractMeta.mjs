/**
 * Read extract meta.json / readiness for reading-context and tool soft-fails.
 */

import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCurrentExtractSchema } from '@wellread/extract-contract';
import { isSafeBookIdSegment } from './notesOkf.mjs';

/**
 * @typedef {'missing' | 'ready' | 'stale'} ExtractStatus
 */

/**
 * @param {string} booksRoot
 * @param {string} bookId
 * @returns {string | null}
 */
export function extractHostRoot(booksRoot, bookId) {
  if (typeof booksRoot !== 'string' || !booksRoot.trim()) return null;
  if (!isSafeBookIdSegment(bookId)) return null;
  return join(booksRoot, '.wellread', 'extract', bookId);
}

/**
 * @param {string} booksRoot
 * @param {string} bookId
 * @returns {{
 *   status: ExtractStatus,
 *   chunkCount: number,
 *   schemaVersion: number | null,
 * }}
 */
export function readExtractStatus(booksRoot, bookId) {
  const root = extractHostRoot(booksRoot, bookId);
  if (!root) {
    return { status: 'missing', chunkCount: 0, schemaVersion: null };
  }
  const metaPath = join(root, 'meta.json');
  let st;
  try {
    st = lstatSync(metaPath);
  } catch {
    return { status: 'missing', chunkCount: 0, schemaVersion: null };
  }
  if (st.isSymbolicLink() || !st.isFile()) {
    return { status: 'missing', chunkCount: 0, schemaVersion: null };
  }
  let raw;
  try {
    raw = readFileSync(metaPath, 'utf8');
  } catch {
    return { status: 'missing', chunkCount: 0, schemaVersion: null };
  }
  try {
    const v = JSON.parse(raw);
    const chunkCount = typeof v.chunkCount === 'number' && v.chunkCount >= 0 ? v.chunkCount : 0;
    const schemaVersion =
      typeof v.schemaVersion === 'number' && Number.isFinite(v.schemaVersion)
        ? v.schemaVersion
        : null;
    const indexPath = join(root, 'section-index.json');
    let hasIndex = false;
    try {
      const ist = lstatSync(indexPath);
      hasIndex = !ist.isSymbolicLink() && ist.isFile();
    } catch {
      hasIndex = false;
    }
    // Current schema ships section-index.json; older trees are usable via scan but marked stale.
    if (!isCurrentExtractSchema(schemaVersion) || !hasIndex) {
      return { status: 'stale', chunkCount, schemaVersion };
    }
    if (v.status && v.status !== 'ready') {
      return { status: 'stale', chunkCount, schemaVersion };
    }
    return { status: 'ready', chunkCount, schemaVersion };
  } catch {
    return { status: 'missing', chunkCount: 0, schemaVersion: null };
  }
}

/**
 * Soft-fail envelope when extract cannot support book tools.
 * @param {ExtractStatus} status
 * @returns {{ ok: false, error: string, message: string } | null}
 */
export function extractUnavailableEnvelope(status) {
  if (status === 'missing') {
    return {
      ok: false,
      error: 'extract_not_ready',
      message: 'Book extract is missing — open the book in the reader and retry after extract finishes',
    };
  }
  return null;
}
