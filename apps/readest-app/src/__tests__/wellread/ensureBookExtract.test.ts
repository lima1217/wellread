/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  chunkFileName,
  formatChunkMarkdown,
  isMetaStale,
  parseExtractMeta,
} from '@/services/wellread/extract/format';
import {
  ensureBookExtract,
  type BooksExtractFs,
} from '@/services/wellread/extract/ensureBookExtract';
import type { BookDoc } from '@/libs/document';

function memoryFs(): BooksExtractFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async exists(path) {
      if (files.has(path)) return true;
      for (const key of files.keys()) {
        if (key.startsWith(`${path}/`)) return true;
      }
      return false;
    },
    async readText(path) {
      return files.get(path) ?? null;
    },
    async writeText(path, content) {
      files.set(path, content);
    },
    async removeDir(path) {
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key);
      }
    },
  };
}

function makeDoc(bodyHtml: string): Document {
  return new DOMParser().parseFromString(
    `<!DOCTYPE html><html><body>${bodyHtml}</body></html>`,
    'text/html',
  );
}

function fakeBookDoc(sectionsHtml: string[]): BookDoc {
  return {
    sections: sectionsHtml.map((html) => ({
      createDocument: async () => makeDoc(html),
    })),
  } as unknown as BookDoc;
}

describe('extract format', () => {
  it('writes chunk markdown with cfi frontmatter and plain body', () => {
    const md = formatChunkMarkdown({
      bookId: 'bk1',
      sectionIndex: 0,
      title: 'Chapter I',
      cfi: 'epubcfi(/6/2!/4/2/1:0)',
      endCfi: 'epubcfi(/6/2!/4/2/1:12)',
      chunkIndex: 0,
      text: 'Call me Ishmael.',
    });
    expect(md).toContain('cfi: "epubcfi(/6/2!/4/2/1:0)"');
    expect(md).toContain('endCfi: "epubcfi(/6/2!/4/2/1:12)"');
    expect(md.trimEnd().endsWith('Call me Ishmael.')).toBe(true);
    expect(md.indexOf('Call me Ishmael.')).toBeGreaterThan(md.indexOf('---', 3));
  });

  it('pads chunk filenames', () => {
    expect(chunkFileName(0, 'Hello World')).toBe('00001-hello-world.md');
  });

  it('detects stale meta by hash or mtime', () => {
    const meta = parseExtractMeta(
      JSON.stringify({
        bookId: 'bk1',
        sourceHash: 'abc',
        sourceMtimeMs: 10,
        format: 'EPUB',
        extractedAt: 1,
        chunkCount: 1,
      }),
    );
    expect(isMetaStale(meta, { sourceHash: 'abc', sourceMtimeMs: 10 })).toBe(false);
    expect(isMetaStale(meta, { sourceHash: 'xyz', sourceMtimeMs: 10 })).toBe(true);
    expect(isMetaStale(meta, { sourceHash: 'abc', sourceMtimeMs: 99 })).toBe(true);
  });
});

describe('ensureBookExtract', () => {
  it('builds toc.md, meta.json, and chunk files with cfi', async () => {
    const fs = memoryFs();
    const result = await ensureBookExtract({
      bookId: 'bk1',
      bookDoc: fakeBookDoc([
        '<p>Call me Ishmael. Some years ago—never mind how long precisely.</p>',
      ]),
      format: 'EPUB',
      sourceHash: 'hash1',
      sourceMtimeMs: 100,
      fs,
    });
    expect(result.status).toBe('rebuilt');
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(fs.files.has('.wellread/extract/bk1/meta.json')).toBe(true);
    expect(fs.files.has('.wellread/extract/bk1/toc.md')).toBe(true);
    const chunkKeys = [...fs.files.keys()].filter((k) => k.includes('/chunks/'));
    expect(chunkKeys.length).toBe(result.chunkCount);
    const sample = fs.files.get(chunkKeys[0]!)!;
    expect(sample).toMatch(/cfi: "epubcfi\(/);
  });

  it('reuses a fresh tree and rebuilds when hash changes', async () => {
    const fs = memoryFs();
    const bookDoc = fakeBookDoc(['<p>Hello world from the extract test.</p>']);
    const first = await ensureBookExtract({
      bookId: 'bk1',
      bookDoc,
      format: 'EPUB',
      sourceHash: 'h1',
      sourceMtimeMs: 1,
      fs,
    });
    expect(first.status).toBe('rebuilt');

    const second = await ensureBookExtract({
      bookId: 'bk1',
      bookDoc,
      format: 'EPUB',
      sourceHash: 'h1',
      sourceMtimeMs: 1,
      fs,
    });
    expect(second.status).toBe('ready');
    expect(second.chunkCount).toBe(first.chunkCount);

    const third = await ensureBookExtract({
      bookId: 'bk1',
      bookDoc,
      format: 'EPUB',
      sourceHash: 'h2',
      sourceMtimeMs: 1,
      fs,
    });
    expect(third.status).toBe('rebuilt');
  });
});
