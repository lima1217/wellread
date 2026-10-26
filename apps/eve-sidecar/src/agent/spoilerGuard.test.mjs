import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { readAnnotationsStatus } from './annotations.mjs';
import { createSpoilerGuard } from './spoilerGuard.mjs';
import { createToolParallelBudget } from './toolParallelBudget.mjs';
import { authorizeReadFilePath, createReadingTools } from './tools.mjs';

/** Two sections, two chunks each; chunk files carry frontmatter + body. */
function seedBook() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'eve-spoiler-')));
  const ex = join(root, '.wellread', 'extract', 'bk1');
  mkdirSync(join(ex, 'chunks'), { recursive: true });
  writeFileSync(
    join(ex, 'meta.json'),
    JSON.stringify({ bookId: 'bk1', chunkCount: 4, schemaVersion: 2, status: 'ready' }),
  );
  const rows = [
    ['00001-a.md', 0, 0, 'epubcfi(/6/2!/4/2/1:0)', 'epubcfi(/6/2!/4/2/1:50)', 'Ishmael goes to sea.'],
    ['00002-b.md', 1, 0, 'epubcfi(/6/2!/4/4/1:0)', 'epubcfi(/6/2!/4/4/1:50)', 'He meets Queequeg.'],
    ['00003-c.md', 2, 1, 'epubcfi(/6/4!/4/2/1:0)', 'epubcfi(/6/4!/4/2/1:50)', 'The whale sinks the ship.'],
    ['00004-d.md', 3, 1, 'epubcfi(/6/4!/4/4/1:0)', 'epubcfi(/6/4!/4/4/1:50)', 'Only Ishmael survives.'],
  ];
  /** @type {Record<string, unknown[]>} */
  const sections = {};
  for (const [fileName, chunkIndex, sectionIndex, cfi, endCfi, body] of rows) {
    writeFileSync(
      join(ex, 'chunks', String(fileName)),
      `---\nsectionIndex: ${sectionIndex}\nchunkIndex: ${chunkIndex}\ntitle: "S${sectionIndex}"\ncfi: "${cfi}"\nendCfi: "${endCfi}"\n---\n\n${body}\n`,
    );
    (sections[String(sectionIndex)] ??= []).push({
      fileName,
      chunkIndex,
      sectionIndex,
      title: `S${sectionIndex}`,
      cfi,
      endCfi,
    });
  }
  writeFileSync(
    join(ex, 'section-index.json'),
    JSON.stringify({ schemaVersion: 2, sections, titles: { s0: [0], s1: [1] } }),
  );
  return root;
}

const chunk = (f) => `/workspace/.wellread/extract/bk1/chunks/${f}`;

function ctx(root, guard) {
  const parallelBudget = createToolParallelBudget();
  parallelBudget.beginStep();
  return {
    toolCallId: 't',
    messages: [],
    context: { bookId: 'bk1', booksRoot: root, parallelBudget, spoilerGuard: guard },
  };
}

describe('createSpoilerGuard', () => {
  it('is off unless enabled with a position', () => {
    const root = seedBook();
    try {
      assert.equal(createSpoilerGuard({ booksRoot: root, bookId: 'bk1' }), null);
      assert.equal(
        createSpoilerGuard({ enabled: true, booksRoot: root, bookId: 'bk1', readerState: {} }),
        null,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('hides chunks starting after the end of the visible range', () => {
    const root = seedBook();
    try {
      const guard = createSpoilerGuard({
        enabled: true,
        booksRoot: root,
        bookId: 'bk1',
        readerState: { cfi: 'epubcfi(/6/2!/4,/2/1:10,/4/1:5)' },
      });
      assert.ok(guard);
      assert.equal(guard.isPathHidden(chunk('00001-a.md')), false);
      assert.equal(guard.isPathHidden(chunk('00002-b.md')), false);
      assert.equal(guard.isPathHidden(chunk('00003-c.md')), true);
      assert.equal(guard.isPathHidden('/workspace/.wellread/notes/bk1/index.md'), false);
      assert.deepEqual(guard.filterPaths([chunk('00002-b.md'), chunk('00004-d.md')]), {
        paths: [chunk('00002-b.md')],
        hidden: 1,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('gates read_file, read_section_text, resolve_section and grep', async () => {
    const root = seedBook();
    try {
      const guard = createSpoilerGuard({
        enabled: true,
        booksRoot: root,
        bookId: 'bk1',
        readerState: { cfi: 'epubcfi(/6/2!/4/4/1:10)' },
      });
      const tools = createReadingTools();
      const read = await tools.read_file.execute({ path: chunk('00004-d.md') }, ctx(root, guard));
      assert.equal(read.ok, false);
      assert.equal(read.error, 'spoiler_guard');

      const later = await tools.read_section_text.execute({ sectionIndex: 1 }, ctx(root, guard));
      assert.equal(later.ok, false);
      assert.equal(later.error, 'spoiler_guard');

      const current = await tools.read_section_text.execute({ sectionIndex: 0 }, ctx(root, guard));
      assert.equal(current.ok, true);
      assert.match(current.text, /Queequeg/);

      const listed = await tools.resolve_section.execute({ sectionIndex: 1 }, ctx(root, guard));
      assert.equal(listed.count, 0);
      assert.equal(listed.hiddenBySpoilerGuard, 2);

      const grep = await tools.grep.execute({ pattern: 'Ishmael', regex: false }, ctx(root, guard));
      assert.equal(grep.ok, true);
      assert.deepEqual(
        grep.hits.map((h) => h.path),
        [chunk('00001-a.md')],
      );
      assert.equal(grep.hiddenBySpoilerGuard, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('annotations export', () => {
  it('counts ### blocks and scopes read_file to the current book', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'eve-annot-')));
    try {
      assert.equal(readAnnotationsStatus(root, 'bk1'), null);
      mkdirSync(join(root, '.wellread', 'annotations'), { recursive: true });
      writeFileSync(
        join(root, '.wellread', 'annotations', 'bk1.md'),
        '# Annotations\n\n### Highlight · S0\n> text\n\n### Note · S1\n> more\nNote: mine\n',
      );
      assert.deepEqual(readAnnotationsStatus(root, 'bk1'), {
        path: '/workspace/.wellread/annotations/bk1.md',
        count: 2,
      });
      assert.equal(authorizeReadFilePath('/workspace/.wellread/annotations/bk1.md', 'bk1').ok, true);
      assert.equal(authorizeReadFilePath('/workspace/.wellread/annotations/bk2.md', 'bk1').ok, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('search_book', () => {
  it('ranks passages by topic and respects the spoiler guard', async () => {
    const { clearBookSearchCache, tokenize } = await import('./bookSearch.mjs');
    clearBookSearchCache();
    assert.deepEqual(tokenize('鲸鱼 whale'), ['鲸', '鲸鱼', '鱼', 'whale']);
    const root = seedBook();
    try {
      const tools = createReadingTools();
      const open = await tools.search_book.execute({ query: 'whale ship' }, ctx(root, undefined));
      assert.equal(open.ok, true);
      assert.match(open.hits[0].path, /00003-c/);
      assert.equal(open.hits[0].cfi, 'epubcfi(/6/4!/4/2/1:0)');
      assert.match(open.hits[0].snippet, /whale/);

      const guard = createSpoilerGuard({
        enabled: true,
        booksRoot: root,
        bookId: 'bk1',
        readerState: { cfi: 'epubcfi(/6/2!/4/4/1:10)' },
      });
      const guarded = await tools.search_book.execute({ query: 'whale ship' }, ctx(root, guard));
      assert.equal(guarded.hits.length, 0);
      assert.equal(guarded.hiddenBySpoilerGuard, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
