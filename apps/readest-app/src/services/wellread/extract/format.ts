import type { ChunkRow } from './CfiChunker';

/** Bump when extract on-disk shape/semantics change (forces rebuild). */
export const EXTRACT_SCHEMA_VERSION = 1;

export type ExtractMeta = {
  bookId: string;
  sourceHash: string;
  sourceMtimeMs: number | null;
  format: string;
  extractedAt: number;
  chunkCount: number;
  schemaVersion: number;
};

export type ExtractChunkInput = {
  bookId: string;
  sectionIndex: number;
  title: string | null;
  cfi: string;
  endCfi: string;
  chunkIndex: number;
  text: string;
};

const SLUG_MAX = 48;

export function slugifyTitle(title: string | null | undefined, fallback: string): string {
  const base = (title ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const clipped = (base || fallback).slice(0, SLUG_MAX);
  return clipped.replace(/-+$/g, '') || fallback;
}

export function chunkFileName(chunkIndex: number, title: string | null): string {
  const n = String(chunkIndex + 1).padStart(5, '0');
  return `${n}-${slugifyTitle(title, 'chunk')}.md`;
}

export function formatChunkMarkdown(chunk: ExtractChunkInput): string {
  const title = chunk.title ?? '';
  return `---
bookId: ${JSON.stringify(chunk.bookId)}
sectionIndex: ${chunk.sectionIndex}
title: ${JSON.stringify(title)}
cfi: ${JSON.stringify(chunk.cfi)}
endCfi: ${JSON.stringify(chunk.endCfi)}
chunkIndex: ${chunk.chunkIndex}
---

${chunk.text}
`;
}

export function formatTocMarkdown(
  bookId: string,
  chunks: Array<{ chunkIndex: number; title: string | null; fileName: string }>,
): string {
  const lines = [`# Extract · ${bookId}`, '', '## Chunks', ''];
  for (const c of chunks) {
    const label = c.title?.trim() || `Chunk ${c.chunkIndex + 1}`;
    lines.push(`- [${label}](chunks/${c.fileName})`);
  }
  lines.push('');
  return lines.join('\n');
}

export function chunkRowToExtractInput(row: ChunkRow, chunkIndex: number): ExtractChunkInput {
  return {
    bookId: row.bookHash,
    sectionIndex: row.sectionIndex,
    title: row.chapterTitle,
    cfi: row.startCfi,
    endCfi: row.endCfi,
    chunkIndex,
    text: row.text,
  };
}

export function extractDir(bookId: string): string {
  return `.wellread/extract/${bookId}`;
}

export function isMetaStale(
  meta: ExtractMeta | null,
  source: { sourceHash: string; sourceMtimeMs: number | null },
): boolean {
  if (!meta) return true;
  if (meta.schemaVersion !== EXTRACT_SCHEMA_VERSION) return true;
  if (meta.sourceHash !== source.sourceHash) return true;
  if (meta.sourceMtimeMs !== source.sourceMtimeMs) return true;
  return false;
}

export function parseExtractMeta(json: string): ExtractMeta | null {
  try {
    const v = JSON.parse(json) as Partial<ExtractMeta>;
    if (typeof v.bookId !== 'string' || typeof v.sourceHash !== 'string') return null;
    return {
      bookId: v.bookId,
      sourceHash: v.sourceHash,
      sourceMtimeMs: typeof v.sourceMtimeMs === 'number' ? v.sourceMtimeMs : null,
      format: typeof v.format === 'string' ? v.format : '',
      extractedAt: typeof v.extractedAt === 'number' ? v.extractedAt : 0,
      chunkCount: typeof v.chunkCount === 'number' ? v.chunkCount : 0,
      schemaVersion: typeof v.schemaVersion === 'number' ? v.schemaVersion : 0,
    };
  } catch {
    return null;
  }
}
