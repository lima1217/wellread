import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { listNotes, readNote, writeNote } from './notesApi.mjs';

describe('notesApi', () => {
  /** @type {string} */
  let booksRoot;
  /** @type {string} */
  let notesRoot;

  beforeEach(() => {
    booksRoot = mkdtempSync(join(tmpdir(), 'wellread-notes-'));
    notesRoot = join(booksRoot, '.wellread', 'notes', 'book1');
    mkdirSync(join(notesRoot, 'concepts'), { recursive: true });
    writeFileSync(join(notesRoot, 'index.md'), '# Index\n');
    writeFileSync(join(notesRoot, 'concepts', 'grace.md'), '# Grace\n');
  });

  afterEach(() => rmSync(booksRoot, { recursive: true, force: true }));

  it('lists the package with index.md first', () => {
    assert.deepEqual(listNotes(booksRoot, 'book1'), {
      ok: true,
      files: ['index.md', 'concepts/grace.md'],
    });
    assert.deepEqual(listNotes(booksRoot, 'missing'), { ok: true, files: [] });
    assert.equal(listNotes(booksRoot, '../x').ok, false);
  });

  it('reads a note and 404s a missing one', async () => {
    assert.deepEqual(await readNote(booksRoot, 'book1', 'concepts/grace.md'), {
      ok: true,
      content: '# Grace\n',
    });
    assert.equal((await readNote(booksRoot, 'book1', 'concepts/none.md')).status, 404);
  });

  it('writes a note inside the package', async () => {
    assert.deepEqual(await writeNote(booksRoot, 'book1', 'concepts/grace.md', '# Edited\n'), {
      ok: true,
    });
    assert.equal(readFileSync(join(notesRoot, 'concepts', 'grace.md'), 'utf8'), '# Edited\n');
  });

  it('rejects paths outside the writable OKF tree', async () => {
    for (const rel of ['../book2/index.md', 'tools/x.md', 'AGENTS.md', 'concepts/x.txt', 'other/x.md']) {
      assert.equal((await writeNote(booksRoot, 'book1', rel, 'x')).status, 400, rel);
      assert.equal((await readNote(booksRoot, 'book1', rel)).status, 400, rel);
    }
    assert.equal((await writeNote(booksRoot, 'book1', 'index.md', 42)).status, 400);
  });
});
