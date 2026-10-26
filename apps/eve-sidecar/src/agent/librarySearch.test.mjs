import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { clearLibrarySearchCache, searchLibrary } from './librarySearch.mjs';
import { createToolParallelBudget } from './toolParallelBudget.mjs';
import { authorizeReadFilePath, createReadingTools } from './tools.mjs';

function seedLibrary() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'eve-library-')));
  const w = join(root, '.wellread');
  mkdirSync(join(w, 'notes', 'sapiens', 'concepts'), { recursive: true });
  mkdirSync(join(w, 'notes', 'sapiens', 'tools'), { recursive: true });
  mkdirSync(join(w, 'notes', 'current', 'concepts'), { recursive: true });
  mkdirSync(join(w, 'annotations'), { recursive: true });
  mkdirSync(join(w, 'memory', 'books'), { recursive: true });
  mkdirSync(join(w, 'extract', 'sapiens', 'chunks'), { recursive: true });
  writeFileSync(
    join(w, 'notes', 'sapiens', 'concepts', 'imagined-order.md'),
    '---\ntitle: "Imagined order"\ntype: Concept\n---\n\nShared myths let strangers cooperate. See [Ch 2](<epubcfi(/6/8!/4/2/1:0)>).\n',
  );
  writeFileSync(join(w, 'notes', 'sapiens', 'tools', 'check.md'), 'cooperate cooperate cooperate\n');
  writeFileSync(join(w, 'notes', 'current', 'concepts', 'x.md'), 'cooperate in the open book\n');
  writeFileSync(
    join(w, 'annotations', 'sapiens.md'),
    '# Reader annotations: Sapiens\n\n### Note · Ch 2\ncfi: epubcfi(/6/8!/4/2/1:10)\n> Money is the most universal system of mutual trust.\nNote: trust and cooperate\n\n### Highlight · Ch 3\ncfi: epubcfi(/6/10!/4/2/1:0)\n> Wheat domesticated us.\n',
  );
  writeFileSync(join(w, 'memory', 'books', 'sapiens.md'), '# Book memory: Sapiens\n\n- Reader linked myths to money.\n');
  writeFileSync(join(w, 'extract', 'sapiens', 'chunks', '00001-a.md'), 'cooperate secret extract text\n');
  return root;
}

describe('searchLibrary', () => {
  it("ranks other books' notes, annotations and memories without cfi values", () => {
    const root = seedLibrary();
    clearLibrarySearchCache();
    try {
      const r = searchLibrary({ booksRoot: root, bookId: 'current', query: 'cooperate trust' });
      assert.equal(r.ok, true);
      const paths = r.hits.map((h) => h.path);
      assert.ok(paths.includes('/workspace/.wellread/notes/sapiens/concepts/imagined-order.md'));
      assert.ok(paths.includes('/workspace/.wellread/annotations/sapiens.md'));
      assert.ok(!paths.some((p) => p.includes('/current/')), 'current book excluded');
      assert.ok(!paths.some((p) => p.includes('/tools/') || p.includes('/extract/')));
      assert.ok(r.hits.every((h) => h.bookId === 'sapiens' && h.bookTitle === 'Sapiens'));
      assert.doesNotMatch(JSON.stringify(r), /epubcfi/);
      const note = r.hits.find((h) => h.kind === 'note');
      assert.equal(note?.heading, 'Imagined order');
      const annotation = r.hits.find((h) => h.kind === 'annotation');
      assert.equal(annotation?.heading, 'Note · Ch 2');

      const memory = searchLibrary({ booksRoot: root, bookId: 'current', query: 'myths money' });
      assert.ok(memory.hits.some((h) => h.kind === 'memory'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves annotations out when sharing is off, and reports an empty library', () => {
    const root = seedLibrary();
    clearLibrarySearchCache();
    try {
      const r = searchLibrary({ booksRoot: root, bookId: 'current', query: 'universal mutual', includeAnnotations: false });
      assert.equal(r.ok, true);
      assert.equal(r.hits.length, 0);
      const none = searchLibrary({ booksRoot: join(root, 'nope'), bookId: 'current', query: 'quantum physics' });
      assert.equal(none.error, 'not_found');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('search_library tool honors shareAnnotations and read_file reaches other notes only', async () => {
    const root = seedLibrary();
    clearLibrarySearchCache();
    try {
      const { search_library } = createReadingTools();
      const ctx = (extra) => ({
        toolCallId: 's1',
        messages: [],
        context: { bookId: 'current', booksRoot: root, parallelBudget: createToolParallelBudget(), ...extra },
      });
      const on = await search_library.execute({ query: 'universal mutual' }, ctx({}));
      assert.equal(on.hits[0]?.kind, 'annotation');
      const off = await search_library.execute({ query: 'universal mutual' }, ctx({ shareAnnotations: false }));
      assert.equal(off.hits.length, 0);

      assert.equal(authorizeReadFilePath('/workspace/.wellread/notes/sapiens/concepts/imagined-order.md', 'current').ok, true);
      assert.equal(authorizeReadFilePath('/workspace/.wellread/memory/books/sapiens.md', 'current').ok, true);
      assert.equal(authorizeReadFilePath('/workspace/.wellread/extract/sapiens/chunks/00001-a.md', 'current').ok, false);
      assert.equal(authorizeReadFilePath('/workspace/.wellread/notes/../extract/sapiens/meta.json', 'current').ok, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
