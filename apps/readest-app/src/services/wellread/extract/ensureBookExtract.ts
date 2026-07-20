import type { BookDoc } from '@/libs/document';
import type { ChunkOptions } from '@/services/reedy/retrieval/CfiChunker';
import { chunkSection } from '@/services/reedy/retrieval/CfiChunker';
import {
  chunkFileName,
  chunkRowToExtractInput,
  extractDir,
  formatChunkMarkdown,
  formatTocMarkdown,
  isMetaStale,
  parseExtractMeta,
  type ExtractMeta,
} from './format';

/** FS relative to Books root (paths use forward slashes). */
export type BooksExtractFs = {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, content: string): Promise<void>;
  removeDir(path: string): Promise<void>;
};

export type EnsureBookExtractInput = {
  bookId: string;
  bookDoc: BookDoc;
  format: string;
  sourceHash: string;
  sourceMtimeMs: number | null;
  fs: BooksExtractFs;
  chunkOptions?: Partial<ChunkOptions>;
  getChapterTitle?: (sectionIndex: number) => string | null;
  /** Skip non-EPUB exact extract (still writes empty/minimal tree). */
  skipChunking?: boolean;
};

export type EnsureBookExtractResult = {
  status: 'ready' | 'rebuilt';
  extractRoot: string;
  chunkCount: number;
};

async function collectChunks(
  bookDoc: BookDoc,
  bookId: string,
  options: Pick<EnsureBookExtractInput, 'chunkOptions' | 'getChapterTitle'>,
) {
  const all = [];
  const sections = bookDoc.sections ?? [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    let doc: Document;
    try {
      doc = await section.createDocument();
    } catch {
      continue;
    }
    const title = options.getChapterTitle?.(i) ?? `Section ${i + 1}`;
    const sectionChunks = chunkSection(doc, i, title, bookId, options.chunkOptions);
    for (const c of sectionChunks) {
      all.push({ ...c, positionIndex: all.length, id: `${bookId}-${all.length}` });
    }
  }
  return all;
}

async function writeExtractTree(
  input: EnsureBookExtractInput,
  chunks: Awaited<ReturnType<typeof collectChunks>>,
): Promise<number> {
  const root = extractDir(input.bookId);
  const chunksDir = `${root}/chunks`;
  if (await input.fs.exists(root)) {
    await input.fs.removeDir(root);
  }

  const tocEntries: Array<{ chunkIndex: number; title: string | null; fileName: string }> = [];
  for (let i = 0; i < chunks.length; i++) {
    const row = chunks[i]!;
    const extractChunk = chunkRowToExtractInput(row, i);
    const fileName = chunkFileName(i, extractChunk.title);
    tocEntries.push({ chunkIndex: i, title: extractChunk.title, fileName });
    await input.fs.writeText(`${chunksDir}/${fileName}`, formatChunkMarkdown(extractChunk));
  }

  await input.fs.writeText(`${root}/toc.md`, formatTocMarkdown(input.bookId, tocEntries));

  const meta: ExtractMeta = {
    bookId: input.bookId,
    sourceHash: input.sourceHash,
    sourceMtimeMs: input.sourceMtimeMs,
    format: input.format,
    extractedAt: Date.now(),
    chunkCount: chunks.length,
  };
  await input.fs.writeText(`${root}/meta.json`, `${JSON.stringify(meta, null, 2)}\n`);
  return chunks.length;
}

/**
 * Ensure `.wellread/extract/<bookId>/` is present and matches source hash/mtime.
 * Host-side only — sidecar consumes the tree via read_file / glob / grep.
 */
export async function ensureBookExtract(
  input: EnsureBookExtractInput,
): Promise<EnsureBookExtractResult> {
  const extractRoot = extractDir(input.bookId);
  const metaPath = `${extractRoot}/meta.json`;
  let existing: ExtractMeta | null = null;
  if (await input.fs.exists(metaPath)) {
    const raw = await input.fs.readText(metaPath);
    existing = raw ? parseExtractMeta(raw) : null;
  }

  const stale = isMetaStale(existing, {
    sourceHash: input.sourceHash,
    sourceMtimeMs: input.sourceMtimeMs,
  });

  if (!stale && existing) {
    return {
      status: 'ready',
      extractRoot,
      chunkCount: existing.chunkCount,
    };
  }

  const chunks = input.skipChunking ? [] : await collectChunks(input.bookDoc, input.bookId, input);

  const chunkCount = await writeExtractTree(input, chunks);
  return {
    status: 'rebuilt',
    extractRoot,
    chunkCount,
  };
}
