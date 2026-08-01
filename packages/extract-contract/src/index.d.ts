/** Bump when extract on-disk shape/semantics change (forces host rebuild). */
export declare const EXTRACT_SCHEMA_VERSION: 2;

/** Host chunk file names: `NNNNN-slug.md`. */
export declare const CHUNK_FILE_NAME_PATTERN: RegExp;

export declare function isSafeChunkFileName(fileName: string): boolean;

export declare function isCurrentExtractSchema(schemaVersion: unknown): boolean;

export type ExtractReadyStatus = 'ready';

export type ExtractMeta = {
  bookId: string;
  sourceHash: string;
  sourceMtimeMs: number | null;
  format: string;
  extractedAt: number;
  chunkCount: number;
  schemaVersion: number;
  /** Present from schema v2; sidecar treats missing meta as extract missing. */
  status: ExtractReadyStatus;
};

export type SectionIndexChunk = {
  fileName: string;
  chunkIndex: number;
  sectionIndex: number;
  title: string | null;
  cfi: string;
  endCfi: string;
};

/** Sidecar-first lookup: sectionIndex → chunks; lowercased title → section indices. */
export type SectionIndexFile = {
  schemaVersion: number;
  sections: Record<string, SectionIndexChunk[]>;
  titles: Record<string, number[]>;
};

export declare const EXTRACT_META_JSON_SCHEMA: Record<string, unknown>;
export declare const SECTION_INDEX_JSON_SCHEMA: Record<string, unknown>;
