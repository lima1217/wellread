/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  EXTRACT_SCHEMA_VERSION,
  chunkFileName,
  formatChunkMarkdown,
  isMetaStale,
  parseExtractMeta,
} from '@/services/wellread/extract/format';
import {
  ensureBookExtract,
  type BooksExtractFs,
} from '@/services/wellread/extract/ensureBookExtract';
import { buildSpineChapterTitleLookup } from '@/services/wellread/extract/spineChapterTitles';
import type { BookDoc, TOCItem } from '@/libs/document';

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

function fakeBookDoc(
  sectionsHtml: string[],
  opts?: {
    sectionIds?: string[];
    toc?: TOCItem[];
  },
): BookDoc {
  const sections = sectionsHtml.map((html, i) => ({
    id: opts?.sectionIds?.[i] ?? `sec-${i}.xhtml`,
    href: opts?.sectionIds?.[i] ?? `sec-${i}.xhtml`,
    createDocument: async () => makeDoc(html),
  }));
  return {
    sections,
    toc: opts?.toc,
    splitTOCHref: (href: string) => {
      const [path, fragment] = href.split('#');
      return [path, fragment];
    },
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

  it('detects stale meta by hash, mtime, or schema version', () => {
    const meta = parseExtractMeta(
      JSON.stringify({
        bookId: 'bk1',
        sourceHash: 'abc',
        sourceMtimeMs: 10,
        format: 'EPUB',
        extractedAt: 1,
        chunkCount: 1,
        schemaVersion: EXTRACT_SCHEMA_VERSION,
        status: 'ready',
      }),
    );
    expect(isMetaStale(meta, { sourceHash: 'abc', sourceMtimeMs: 10 })).toBe(false);
    expect(isMetaStale(meta, { sourceHash: 'xyz', sourceMtimeMs: 10 })).toBe(true);
    expect(isMetaStale(meta, { sourceHash: 'abc', sourceMtimeMs: 99 })).toBe(true);

    const legacy = parseExtractMeta(
      JSON.stringify({
        bookId: 'bk1',
        sourceHash: 'abc',
        sourceMtimeMs: 10,
        format: 'EPUB',
        extractedAt: 1,
        chunkCount: 1,
      }),
    );
    expect(isMetaStale(legacy, { sourceHash: 'abc', sourceMtimeMs: 10 })).toBe(true);
  });
});

describe('buildSpineChapterTitleLookup', () => {
  it('maps TOC labels onto spine indices (first label wins)', () => {
    const bookDoc = fakeBookDoc(['<p>a</p>', '<p>b</p>', '<p>c</p>'], {
      sectionIds: ['ch1.xhtml', 'ch2.xhtml', 'ch3.xhtml'],
      toc: [
        { id: 1, label: 'Loomings', href: 'ch1.xhtml', index: 0 },
        { id: 2, label: 'Unbelievable scenes', href: 'ch2.xhtml#frag', index: 1 },
        { id: 3, label: 'Later fragment', href: 'ch2.xhtml#other', index: 2 },
      ],
    });
    const lookup = buildSpineChapterTitleLookup(bookDoc);
    expect(lookup(0)).toBe('Loomings');
    expect(lookup(1)).toBe('Unbelievable scenes');
    expect(lookup(2)).toBeNull();
  });
});

describe('ensureBookExtract', () => {
  it('builds toc.md, meta.json, section-index.json, and chunk files with cfi', async () => {
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
    expect(fs.files.has('.wellread/extract/bk1/section-index.json')).toBe(true);
    const meta = JSON.parse(fs.files.get('.wellread/extract/bk1/meta.json')!);
    expect(meta.status).toBe('ready');
    expect(meta.schemaVersion).toBe(EXTRACT_SCHEMA_VERSION);
    const index = JSON.parse(fs.files.get('.wellread/extract/bk1/section-index.json')!);
    expect(index.sections['0']?.length).toBeGreaterThan(0);
    expect(index.sections['0'][0].cfi).toMatch(/^epubcfi\(/);
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

  it('writes TOC chapter titles into chunk frontmatter and schemaVersion into meta', async () => {
    const fs = memoryFs();
    const bookDoc = fakeBookDoc(
      ['<p>Call me Ishmael. Some years ago never mind how long precisely.</p>'],
      {
        sectionIds: ['loomings.xhtml'],
        toc: [{ id: 1, label: 'Loomings', href: 'loomings.xhtml', index: 0 }],
      },
    );
    await ensureBookExtract({
      bookId: 'bk1',
      bookDoc,
      format: 'EPUB',
      sourceHash: 'h1',
      sourceMtimeMs: 1,
      fs,
      getChapterTitle: buildSpineChapterTitleLookup(bookDoc),
    });
    const meta = JSON.parse(fs.files.get('.wellread/extract/bk1/meta.json')!);
    expect(meta.schemaVersion).toBe(EXTRACT_SCHEMA_VERSION);
    const chunkKeys = [...fs.files.keys()].filter((k) => k.includes('/chunks/'));
    const sample = fs.files.get(chunkKeys[0]!)!;
    expect(sample).toContain('title: "Loomings"');
    expect(fs.files.get('.wellread/extract/bk1/toc.md')).toContain('Loomings');
  });
});
