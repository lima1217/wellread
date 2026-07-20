/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { globWellread, grepWellread } from '@/services/wellread/search/wellreadSearch';

const SANDBOX = path.join(process.cwd(), '.test-sandbox-wellread-search');

describe('wellreadSearch', () => {
  let booksRoot: string;

  beforeEach(async () => {
    await fsp.mkdir(SANDBOX, { recursive: true });
    booksRoot = await fsp.mkdtemp(path.join(SANDBOX, 'books-'));
    await fsp.mkdir(path.join(booksRoot, 'fiction'), { recursive: true });
    await fsp.writeFile(path.join(booksRoot, 'fiction', 'moby.epub'), 'binary');
    const extract = path.join(booksRoot, '.wellread', 'extract', 'bk1', 'chunks');
    await fsp.mkdir(extract, { recursive: true });
    await fsp.writeFile(
      path.join(extract, '00001-chapter.md'),
      '---\ncfi: "epubcfi(/6/2!/4/2)"\n---\n\nCall me Ishmael.\n',
    );
    await fsp.writeFile(
      path.join(extract, '00002-chapter.md'),
      '---\ncfi: "epubcfi(/6/4!/4/2)"\n---\n\nSome years ago.\n',
    );
  });

  afterEach(async () => {
    await fsp.rm(booksRoot, { recursive: true, force: true });
  });

  it('globs only under .wellread', async () => {
    const hits = globWellread(booksRoot, '/workspace/.wellread/**/*.md');
    expect(hits.map((h) => h.path)).toEqual([
      '/workspace/.wellread/extract/bk1/chunks/00001-chapter.md',
      '/workspace/.wellread/extract/bk1/chunks/00002-chapter.md',
    ]);
  });

  it('rejects glob targeting book binaries', () => {
    expect(() => globWellread(booksRoot, '/workspace/fiction/*.epub')).toThrow(/glob only under/);
  });

  it('greps chunk text and returns workspace paths', () => {
    const hits = grepWellread(booksRoot, 'Ishmael');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.path).toContain('.wellread/extract/bk1/chunks/00001-chapter.md');
    expect(hits[0]!.text).toContain('Ishmael');
  });

  it('rejects grep outside .wellread', () => {
    expect(() => grepWellread(booksRoot, 'binary', { path: '/workspace/fiction' })).toThrow();
  });
});
