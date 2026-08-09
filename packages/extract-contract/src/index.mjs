/**
 * On-disk extract contract shared by readest-app (writer) and eve-sidecar (reader).
 * Docs: apps/readest-app/docs/reading-assistant-contract.md
 */

/** Bump when extract on-disk shape/semantics change (forces host rebuild). */
export const EXTRACT_SCHEMA_VERSION = 2;

/**
 * Host chunk file names: `NNNNN-slug.md` (see format.chunkFileName).
 * At least 5 digits; more digits allowed so writers past 99999 still match.
 * Sidecar rejects index rows that do not match (path-traversal guard).
 */
export const CHUNK_FILE_NAME_PATTERN = /^\d{5,}-[a-z0-9-]+\.md$/;

/**
 * @param {string} fileName
 */
export function isSafeChunkFileName(fileName) {
  if (typeof fileName !== 'string') return false;
  const name = fileName.trim();
  if (!name) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return false;
  if (name === '.' || name === '..' || name.includes('..')) return false;
  return CHUNK_FILE_NAME_PATTERN.test(name);
}

/**
 * True when meta.schemaVersion is usable by this reader (≥ current contract).
 * Forward-compatible: newer writers may bump the version while keeping shape.
 * Host rebuild gates should still use strict equality when deciding to rewrite.
 * @param {unknown} schemaVersion
 */
export function isCurrentExtractSchema(schemaVersion) {
  return (
    typeof schemaVersion === 'number' &&
    Number.isFinite(schemaVersion) &&
    schemaVersion >= EXTRACT_SCHEMA_VERSION
  );
}

/**
 * JSON Schema (draft-07-ish) for `meta.json`.
 * Informative for docs/tests; runtime parse stays lightweight.
 */
export const EXTRACT_META_JSON_SCHEMA = {
  $id: 'wellread:extract/meta.json',
  type: 'object',
  required: [
    'bookId',
    'sourceHash',
    'format',
    'extractedAt',
    'chunkCount',
    'schemaVersion',
    'status',
  ],
  additionalProperties: true,
  properties: {
    bookId: { type: 'string', minLength: 1 },
    sourceHash: { type: 'string', minLength: 1 },
    sourceMtimeMs: { type: ['number', 'null'] },
    format: { type: 'string' },
    extractedAt: { type: 'number' },
    chunkCount: { type: 'number', minimum: 0 },
    schemaVersion: { type: 'number', minimum: EXTRACT_SCHEMA_VERSION },
    status: { type: 'string', const: 'ready' },
  },
};

/**
 * JSON Schema for `section-index.json`.
 */
export const SECTION_INDEX_JSON_SCHEMA = {
  $id: 'wellread:extract/section-index.json',
  type: 'object',
  required: ['schemaVersion', 'sections', 'titles'],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'number', minimum: EXTRACT_SCHEMA_VERSION },
    sections: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: { $ref: '#/$defs/SectionIndexChunk' },
      },
    },
    titles: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: { type: 'number', minimum: 0 },
      },
    },
  },
  $defs: {
    SectionIndexChunk: {
      type: 'object',
      required: ['fileName', 'chunkIndex', 'sectionIndex', 'cfi', 'endCfi'],
      additionalProperties: false,
      properties: {
        fileName: {
          type: 'string',
          pattern: String(CHUNK_FILE_NAME_PATTERN).slice(1, -1),
        },
        chunkIndex: { type: 'number', minimum: 0 },
        sectionIndex: { type: 'number', minimum: 0 },
        title: { type: ['string', 'null'] },
        cfi: { type: 'string' },
        endCfi: { type: 'string' },
      },
    },
  },
};
