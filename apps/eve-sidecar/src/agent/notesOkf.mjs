/**
 * OKF notes-package layout + bookId path safety (leaf SSOT).
 * Consumed by prompt, tools, and HTTP handlers — do not import those from here.
 */

/** Writable root files under notes/<bookId>/. AGENTS.md is skill-bundled, not notes-writable. */
export const OKF_NOTES_ROOT_FILES = Object.freeze(['index.md', 'log.md']);

/** Writable top-level directories (PACKAGE.md). tools/ is skill-bundled only — not writable. */
export const OKF_NOTES_DIRS = Object.freeze([
  'sources',
  'chapters',
  'concepts',
  'frameworks',
  'claims',
  'glossary',
  'questions',
]);

/**
 * bookId must be a single path segment (no separators / traversal).
 * @param {unknown} bookId
 */
export function isSafeBookIdSegment(bookId) {
  if (typeof bookId !== 'string' || !bookId) return false;
  if (bookId !== bookId.trim()) return false;
  if (bookId === '.' || bookId === '..') return false;
  if (/[/\\]/.test(bookId)) return false;
  if (/[\r\n\u0000]/.test(bookId)) return false;
  return true;
}

/**
 * Workspace path of the current book's notes package root (no trailing slash).
 * @param {string} bookId
 * @returns {string | null}
 */
export function notesPackageWorkspaceRoot(bookId) {
  if (!isSafeBookIdSegment(bookId)) return null;
  return `/workspace/.wellread/notes/${bookId}`;
}
