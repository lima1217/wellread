import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  SECTION_CHUNKS_ASK_THRESHOLD,
  parseExtractChunkFrontmatter,
  resolveSectionChunksByIndex,
  resolveSectionChunksByTitle,
  resolveSectionChunksForReader,
  resolveSectionQuery,
} from './resolveSectionChunks.mjs';

function writeChunk(dir, fileName, fields, body = 'body') {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    lines.push(`${k}: ${v}`);
  }
  lines.push('---', '', body, '');
  writeFileSync(join(dir, fileName), lines.join('\n'));
}

describe('parseExtractChunkFrontmatter', () => {
  it('reads sectionIndex, chunkIndex, and JSON title', () => {
    const meta = parseExtractChunkFrontmatter(`---
bookId: "bk1"
sectionIndex: 4
title: "On Digital Extremities"
cfi: "epubcfi(/6/10!)"
chunkIndex: 12
---

text
`);
    assert.deepEqual(meta, {
      sectionIndex: 4,
      chunkIndex: 12,
      title: 'On Digital Extremities',
    });
  });

  it('returns null without frontmatter', () => {
    assert.equal(parseExtractChunkFrontmatter('plain'), null);
  });
});

describe('resolveSectionChunksByIndex', () => {
  it('returns workspace paths sorted by chunkIndex', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-sec-chunks-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    writeChunk(chunks, '00002-b.md', {
      sectionIndex: 4,
      chunkIndex: 2,
      title: '"B"',
      cfi: '"epubcfi(/6/2!)"',
    });
    writeChunk(chunks, '00001-a.md', {
      sectionIndex: 4,
      chunkIndex: 1,
      title: '"A"',
      cfi: '"epubcfi(/6/2!)"',
    });
    writeChunk(chunks, '00003-other.md', {
      sectionIndex: 5,
      chunkIndex: 3,
      title: '"Other"',
      cfi: '"epubcfi(/6/4!)"',
    });

    const resolved = resolveSectionChunksByIndex(root, 'bk1', 4);
    assert.equal(resolved.count, 2);
    assert.deepEqual(resolved.paths, [
      '/workspace/.wellread/extract/bk1/chunks/00001-a.md',
      '/workspace/.wellread/extract/bk1/chunks/00002-b.md',
    ]);
  });

  it('returns empty when extract is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-sec-empty-'));
    const resolved = resolveSectionChunksByIndex(root, 'bk1', 0);
    assert.deepEqual(resolved.paths, []);
    assert.equal(resolved.count, 0);
  });

  it('skips symlink chunk files (no follow out of extract)', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-sec-symlink-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    const outside = join(root, 'outside.md');
    writeFileSync(
      outside,
      `---
sectionIndex: 4
chunkIndex: 0
title: "Leaked"
cfi: "epubcfi(/6/2!)"
---

secret
`,
    );
    symlinkSync(outside, join(chunks, '00001-link.md'));
    writeChunk(chunks, '00002-real.md', {
      sectionIndex: 4,
      chunkIndex: 1,
      title: '"Real"',
      cfi: '"epubcfi(/6/2!)"',
    });
    const resolved = resolveSectionChunksByIndex(root, 'bk1', 4);
    assert.equal(resolved.count, 1);
    assert.match(resolved.paths[0] ?? '', /00002-real/);
  });
});

describe('resolveSectionChunksByTitle', () => {
  it('matches exact frontmatter title', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-sec-title-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    writeChunk(chunks, '00001-x.md', {
      sectionIndex: 2,
      chunkIndex: 0,
      title: '"On Digital Extremities"',
      cfi: '"epubcfi(/6/2!)"',
    });
    const resolved = resolveSectionChunksByTitle(
      root,
      'bk1',
      'On Digital Extremities',
    );
    assert.equal(resolved.count, 1);
    assert.equal(
      resolved.paths[0],
      '/workspace/.wellread/extract/bk1/chunks/00001-x.md',
    );
  });

  it('falls back to case-insensitive title match', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-sec-title-ci-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    writeChunk(chunks, '00001-x.md', {
      sectionIndex: 2,
      chunkIndex: 0,
      title: '"On Digital Extremities"',
      cfi: '"epubcfi(/6/2!)"',
    });
    const resolved = resolveSectionChunksByTitle(
      root,
      'bk1',
      'on digital extremities',
    );
    assert.equal(resolved.count, 1);
  });
});

describe('resolveSectionQuery', () => {
  it('requires sectionIndex or title', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-sec-query-'));
    const r = resolveSectionQuery({ booksRoot: root, bookId: 'bk1' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'invalid_args');
  });

  it('prefers sectionIndex when both are set', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-sec-query-pref-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    writeChunk(chunks, '00001-idx.md', {
      sectionIndex: 4,
      chunkIndex: 0,
      title: '"From Index"',
      cfi: '"epubcfi(/6/2!)"',
    });
    writeChunk(chunks, '00002-title.md', {
      sectionIndex: 9,
      chunkIndex: 1,
      title: '"Named Chapter"',
      cfi: '"epubcfi(/6/4!)"',
    });
    const r = resolveSectionQuery({
      booksRoot: root,
      bookId: 'bk1',
      sectionIndex: 4,
      title: 'Named Chapter',
    });
    assert.equal(r.ok, true);
    assert.equal(r.via, 'sectionIndex');
    assert.equal(r.count, 1);
    assert.match(r.paths[0], /00001-idx/);
  });

  it('sets askBeforeReadingAll when over threshold', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-sec-query-ask-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    for (let i = 0; i < SECTION_CHUNKS_ASK_THRESHOLD + 1; i++) {
      writeChunk(chunks, `${String(i + 1).padStart(5, '0')}.md`, {
        sectionIndex: 1,
        chunkIndex: i,
        title: '"Long"',
        cfi: `"epubcfi(/6/${i}!)"`,
      });
    }
    const r = resolveSectionQuery({
      booksRoot: root,
      bookId: 'bk1',
      sectionIndex: 1,
    });
    assert.equal(r.ok, true);
    assert.equal(r.count, SECTION_CHUNKS_ASK_THRESHOLD + 1);
    assert.equal(r.askBeforeReadingAll, true);
  });
});

describe('resolveSectionChunksForReader', () => {
  it('prefers sectionIndex over chapter title', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-sec-reader-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    writeChunk(chunks, '00001-idx.md', {
      sectionIndex: 4,
      chunkIndex: 0,
      title: '"From Index"',
      cfi: '"epubcfi(/6/2!)"',
    });
    writeChunk(chunks, '00002-title.md', {
      sectionIndex: 9,
      chunkIndex: 1,
      title: '"Named Chapter"',
      cfi: '"epubcfi(/6/4!)"',
    });

    const resolved = resolveSectionChunksForReader({
      booksRoot: root,
      bookId: 'bk1',
      readerState: { sectionIndex: 4, chapter: 'Named Chapter' },
    });
    assert.equal(resolved?.via, 'sectionIndex');
    assert.equal(resolved?.count, 1);
    assert.match(resolved?.paths[0] ?? '', /00001-idx/);
  });

  it('falls back to chapter title when sectionIndex is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-sec-fallback-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    writeChunk(chunks, '00001-t.md', {
      sectionIndex: 2,
      chunkIndex: 0,
      title: '"Named Chapter"',
      cfi: '"epubcfi(/6/2!)"',
    });
    const resolved = resolveSectionChunksForReader({
      booksRoot: root,
      bookId: 'bk1',
      readerState: { chapter: 'Named Chapter' },
    });
    assert.equal(resolved?.via, 'title');
    assert.equal(resolved?.count, 1);
  });

  it('exposes ask threshold constant used by envelope', () => {
    assert.equal(SECTION_CHUNKS_ASK_THRESHOLD, 20);
  });
});
