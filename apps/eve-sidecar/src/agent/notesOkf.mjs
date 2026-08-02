/**
 * OKF notes-package layout + bookId path safety (leaf SSOT).
 * Consumed by prompt, tools, noteCompose, and HTTP handlers — do not import those from here.
 */

/** Writable root files under notes/<bookId>/. AGENTS.md is skill-bundled, not notes-writable. */
export const OKF_NOTES_ROOT_FILES = Object.freeze(['index.md', 'log.md']);

/**
 * Content-page kinds: filesystem dir ↔ frontmatter `type` (PACKAGE.md).
 * Single registry for path gates and structured compose schemas.
 *
 * @type {ReadonlyArray<Readonly<{ dir: string, type: string }>>}
 */
export const OKF_PAGE_KINDS = Object.freeze([
  Object.freeze({ dir: 'sources', type: 'Source' }),
  Object.freeze({ dir: 'chapters', type: 'ChapterNote' }),
  Object.freeze({ dir: 'concepts', type: 'Concept' }),
  Object.freeze({ dir: 'frameworks', type: 'Framework' }),
  Object.freeze({ dir: 'claims', type: 'Claim' }),
  Object.freeze({ dir: 'glossary', type: 'Glossary' }),
  Object.freeze({ dir: 'questions', type: 'OpenQuestions' }),
]);

/** Writable top-level directories (PACKAGE.md). tools/ is skill-bundled only — not writable. */
export const OKF_NOTES_DIRS = Object.freeze(OKF_PAGE_KINDS.map((k) => k.dir));

/** Frontmatter `type` values for composable content pages. */
export const OKF_COMPOSE_PAGE_TYPES = Object.freeze(OKF_PAGE_KINDS.map((k) => k.type));

/**
 * @param {string} dir
 * @returns {string | null}
 */
export function okfComposeTypeForDir(dir) {
  return OKF_PAGE_KINDS.find((k) => k.dir === dir)?.type ?? null;
}

/**
 * @param {string} type
 * @returns {string | null}
 */
export function okfDirForComposeType(type) {
  return OKF_PAGE_KINDS.find((k) => k.type === type)?.dir ?? null;
}

/**
 * @param {string} dir
 * @param {string} type
 */
export function okfDraftMatchesDir(dir, type) {
  return OKF_PAGE_KINDS.some((k) => k.dir === dir && k.type === type);
}

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
