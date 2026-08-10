import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parseExtractChunkFrontmatter } from './extractChunk.mjs';
import {
  FOCUS_CHUNKS_MAX,
  SECTION_CHUNKS_ASK_THRESHOLD,
  resolveFocusChunks,
  resolveSectionChunksByIndex,
  resolveSectionChunksByTitle,
  resolveSectionChunksForReader,
  contextWindowToMaxReadBytes,
  readSectionText,
  resolveSectionQuery,
  MIN_READ_SECTION_TEXT_BYTES,
  MAX_READ_SECTION_TEXT_BYTES,
  READ_SECTION_TEXT_MAX_BYTES,
} from './resolveSectionChunks.mjs';

function writeSectionIndex(root, bookId, index) {
  const dir = join(root, '.wellread', 'extract', bookId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'section-index.json'), JSON.stringify(index, null, 2));
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      bookId,
      sourceHash: 'h',
      sourceMtimeMs: 1,
      format: 'EPUB',
      extractedAt: 1,
      chunkCount: 1,
      schemaVersion: 2,
      status: 'ready',
    }),
  );
}

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
      cfi: 'epubcfi(/6/10!)',
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
    assert.equal(SECTION_CHUNKS_ASK_THRESHOLD, 64);
  });
});

describe('section-index resolve', () => {
  it('drops path-traversing fileName entries from section-index.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-sec-trav-'));
    writeSectionIndex(root, 'bk1', {
      schemaVersion: 2,
      sections: {
        '4': [
          {
            fileName: '../../../notes/victim/secret.md',
            chunkIndex: 0,
            sectionIndex: 4,
            title: 'A',
            cfi: 'epubcfi(/6/10!/4/2/1:0)',
            endCfi: 'epubcfi(/6/10!/4/2/1:20)',
          },
          {
            fileName: '00001-a.md',
            chunkIndex: 1,
            sectionIndex: 4,
            title: 'A',
            cfi: 'epubcfi(/6/10!/4/2/1:21)',
            endCfi: 'epubcfi(/6/10!/4/2/1:40)',
          },
        ],
      },
      titles: { a: [4] },
    });
    const resolved = resolveSectionChunksByIndex(root, 'bk1', 4);
    assert.equal(resolved.fromIndex, true);
    assert.equal(resolved.count, 1);
    assert.match(resolved.paths[0], /00001-a/);
    assert.doesNotMatch(resolved.paths.join('\n'), /\.\./);
  });

  it('resolveSectionChunksByIndex uses section-index.json without scanning other sections', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-sec-index-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    writeChunk(chunks, '00001-a.md', {
      sectionIndex: 4,
      chunkIndex: 0,
      title: '"A"',
      cfi: '"epubcfi(/6/10!/4/2/1:0)"',
      endCfi: '"epubcfi(/6/10!/4/2/1:20)"',
    });
    writeSectionIndex(root, 'bk1', {
      schemaVersion: 2,
      sections: {
        '4': [
          {
            fileName: '00001-a.md',
            chunkIndex: 0,
            sectionIndex: 4,
            title: 'A',
            cfi: 'epubcfi(/6/10!/4/2/1:0)',
            endCfi: 'epubcfi(/6/10!/4/2/1:20)',
          },
        ],
      },
      titles: { a: [4] },
    });
    const resolved = resolveSectionChunksByIndex(root, 'bk1', 4);
    assert.equal(resolved.fromIndex, true);
    assert.equal(resolved.count, 1);
    assert.match(resolved.paths[0], /00001-a/);
  });
});

describe('resolveFocusChunks', () => {
  it('selects the covering CFI chunk and optional neighbor', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-focus-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    writeSectionIndex(root, 'bk1', {
      schemaVersion: 2,
      sections: {
        '1': [
          {
            fileName: '00001-a.md',
            chunkIndex: 0,
            sectionIndex: 1,
            title: 'A',
            cfi: 'epubcfi(/6/4!/4/2/1:0)',
            endCfi: 'epubcfi(/6/4!/4/2/1:10)',
          },
          {
            fileName: '00002-b.md',
            chunkIndex: 1,
            sectionIndex: 1,
            title: 'A',
            cfi: 'epubcfi(/6/4!/4/2/1:11)',
            endCfi: 'epubcfi(/6/4!/4/2/1:30)',
          },
          {
            fileName: '00003-c.md',
            chunkIndex: 2,
            sectionIndex: 1,
            title: 'A',
            cfi: 'epubcfi(/6/4!/4/2/1:31)',
            endCfi: 'epubcfi(/6/4!/4/2/1:50)',
          },
        ],
      },
      titles: { a: [1] },
    });
    const focus = resolveFocusChunks({
      booksRoot: root,
      bookId: 'bk1',
      readerState: {
        sectionIndex: 1,
        cfi: 'epubcfi(/6/4!/4/2/1:15)',
      },
    });
    assert.equal(focus?.via, 'cfi');
    assert.ok((focus?.count ?? 0) <= FOCUS_CHUNKS_MAX);
    assert.match(focus?.paths[0] ?? '', /00002-b/);
  });

  it('ignores oversized reader CFI instead of hanging', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-focus-long-'));
    writeSectionIndex(root, 'bk1', {
      schemaVersion: 2,
      sections: {
        '0': [
          {
            fileName: '00001-a.md',
            chunkIndex: 0,
            sectionIndex: 0,
            title: 'A',
            cfi: 'epubcfi(/6/2!/4/2/1:0)',
            endCfi: 'epubcfi(/6/2!/4/2/1:5)',
          },
        ],
      },
      titles: {},
    });
    const focus = resolveFocusChunks({
      booksRoot: root,
      bookId: 'bk1',
      readerState: {
        sectionIndex: 0,
        cfi: `epubcfi(${'2!'.repeat(100_000)})`,
      },
    });
    assert.equal(focus?.via, 'section_mid');
    assert.ok((focus?.count ?? 0) >= 1);
  });

  it('falls back to section midpoint when CFI misses', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-focus-mid-'));
    writeSectionIndex(root, 'bk1', {
      schemaVersion: 2,
      sections: {
        '0': [
          {
            fileName: '00001-a.md',
            chunkIndex: 0,
            sectionIndex: 0,
            title: 'A',
            cfi: 'epubcfi(/6/2!/4/2/1:0)',
            endCfi: 'epubcfi(/6/2!/4/2/1:5)',
          },
          {
            fileName: '00002-b.md',
            chunkIndex: 1,
            sectionIndex: 0,
            title: 'A',
            cfi: 'epubcfi(/6/2!/4/2/1:6)',
            endCfi: 'epubcfi(/6/2!/4/2/1:10)',
          },
          {
            fileName: '00003-c.md',
            chunkIndex: 2,
            sectionIndex: 0,
            title: 'A',
            cfi: 'epubcfi(/6/2!/4/2/1:11)',
            endCfi: 'epubcfi(/6/2!/4/2/1:20)',
          },
        ],
      },
      titles: {},
    });
    const focus = resolveFocusChunks({
      booksRoot: root,
      bookId: 'bk1',
      readerState: {
        sectionIndex: 0,
        cfi: 'epubcfi(/6/99!/4/2/1:0)',
      },
    });
    assert.equal(focus?.via, 'section_mid');
    assert.ok((focus?.count ?? 0) >= 1);
  });
});

describe('readSectionText', () => {
  it('requires sectionIndex or title', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-read-sec-'));
    const r = readSectionText({ booksRoot: root, bookId: 'bk1' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'invalid_args');
  });

  it('concatenates all chunks of a section by sectionIndex', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-read-sec-idx-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    writeChunk(chunks, '00001-a.md', {
      sectionIndex: 3,
      chunkIndex: 0,
      title: '"Loomings"',
      cfi: '"epubcfi(/6/2!)"',
      endCfi: '"epubcfi(/6/2!/4)"',
    }, 'First paragraph.');
    writeChunk(chunks, '00002-b.md', {
      sectionIndex: 3,
      chunkIndex: 1,
      title: '"Loomings"',
      cfi: '"epubcfi(/6/2!/4)"',
      endCfi: '"epubcfi(/6/2!/8)"',
    }, 'Second paragraph.');

    const r = readSectionText({ booksRoot: root, bookId: 'bk1', sectionIndex: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.chunkCount, 2);
    assert.equal(r.via, 'sectionIndex');
    assert.equal(r.sectionIndex, 3);
    assert.match(r.text, /First paragraph\./);
    assert.match(r.text, /Second paragraph\./);
  });

  it('concatenates chunks by title match', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-read-sec-title-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    writeChunk(chunks, '00001-x.md', {
      sectionIndex: 5,
      chunkIndex: 0,
      title: '"The Chase"',
      cfi: '"epubcfi(/6/10!)"',
    }, 'Body A');
    writeChunk(chunks, '00002-y.md', {
      sectionIndex: 6,
      chunkIndex: 0,
      title: '"Other"',
      cfi: '"epubcfi(/6/12!)"',
    }, 'Body B');

    const r = readSectionText({ booksRoot: root, bookId: 'bk1', title: 'The Chase' });
    assert.equal(r.ok, true);
    assert.equal(r.chunkCount, 1);
    assert.equal(r.via, 'title');
    assert.match(r.text, /Body A/);
    assert.doesNotMatch(r.text, /Body B/);
  });

  it('returns not_found for a missing section', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-read-sec-miss-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    writeChunk(chunks, '00001-z.md', {
      sectionIndex: 0,
      chunkIndex: 0,
      title: '"Real"',
      cfi: '"epubcfi(/6/2!)"',
    }, 'body');

    const r = readSectionText({ booksRoot: root, bookId: 'bk1', sectionIndex: 99 });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not_found');
  });

  it('strips frontmatter to compact projection', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-read-sec-proj-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    writeChunk(chunks, '00001-p.md', {
      sectionIndex: 1,
      chunkIndex: 0,
      title: '"Proj"',
      cfi: '"epubcfi(/6/2!)"',
      endCfi: '"epubcfi(/6/2!/2)"',
    }, 'Visible body.');

    const r = readSectionText({ booksRoot: root, bookId: 'bk1', sectionIndex: 1 });
    assert.equal(r.ok, true);
    assert.match(r.text, /Visible body\./);
    assert.doesNotMatch(r.text, /bookId/);
    assert.match(r.text, /cfi:/);
  });
});

describe('contextWindowToMaxReadBytes', () => {
  it('returns the default for invalid / missing context window', () => {
    assert.equal(contextWindowToMaxReadBytes(0), READ_SECTION_TEXT_MAX_BYTES);
    assert.equal(contextWindowToMaxReadBytes(-1), READ_SECTION_TEXT_MAX_BYTES);
    assert.equal(contextWindowToMaxReadBytes(NaN), READ_SECTION_TEXT_MAX_BYTES);
    assert.equal(contextWindowToMaxReadBytes(undefined), READ_SECTION_TEXT_MAX_BYTES);
  });

  it('scales up with a large context window but caps at the hard ceiling', () => {
    // DeepSeek 1M tokens -> 0.75 * 1_000_000 * 3.5 = 2_625_000, capped to 1MB
    const val = contextWindowToMaxReadBytes(1_000_000);
    assert.equal(val, MAX_READ_SECTION_TEXT_BYTES);
  });

  it('floors to the minimum for a tiny context window', () => {
    // 128k tokens -> 0.75 * 128_000 * 3.5 = 336_000 (above 16KB min, below 1MB max)
    const val128 = contextWindowToMaxReadBytes(128_000);
    assert.ok(val128 > MIN_READ_SECTION_TEXT_BYTES);
    assert.ok(val128 < MAX_READ_SECTION_TEXT_BYTES);

    // 1k tokens -> 0.75 * 1000 * 3.5 = 2625, floored to 16KB
    const tiny = contextWindowToMaxReadBytes(1000);
    assert.equal(tiny, MIN_READ_SECTION_TEXT_BYTES);
  });
});

describe('readSectionText maxBytes', () => {
  it('respects a custom maxBytes and sets truncated', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-read-sec-maxb-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    // Write 3 chunks each with ~100 bytes of body
    writeChunk(chunks, '00001-a.md', {
      sectionIndex: 2,
      chunkIndex: 0,
      title: '"Cap"',
      cfi: '"epubcfi(/6/2!)"',
    }, 'AAAA '.repeat(30));
    writeChunk(chunks, '00002-b.md', {
      sectionIndex: 2,
      chunkIndex: 1,
      title: '"Cap"',
      cfi: '"epubcfi(/6/2!/2)"',
    }, 'BBBB '.repeat(30));
    writeChunk(chunks, '00003-c.md', {
      sectionIndex: 2,
      chunkIndex: 2,
      title: '"Cap"',
      cfi: '"epubcfi(/6/2!/4)"',
    }, 'CCCC '.repeat(30));

    // Use a very small maxBytes so only the first chunk fits
    const r = readSectionText({
      booksRoot: root,
      bookId: 'bk1',
      sectionIndex: 2,
      maxBytes: 200,
    });
    assert.equal(r.ok, true);
    assert.equal(r.truncated, true);
    assert.equal(r.chunkCount, 1);
    assert.match(r.text, /AAAA/);
  });

  it('falls back to default constant when maxBytes is omitted', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-read-sec-defb-'));
    const chunks = join(root, '.wellread', 'extract', 'bk1', 'chunks');
    mkdirSync(chunks, { recursive: true });
    writeChunk(chunks, '00001-d.md', {
      sectionIndex: 0,
      chunkIndex: 0,
      title: '"Def"',
      cfi: '"epubcfi(/6/2!)"',
    }, 'small body');

    const r = readSectionText({ booksRoot: root, bookId: 'bk1', sectionIndex: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.chunkCount, 1);
    assert.equal(r.truncated, undefined);
  });
});
