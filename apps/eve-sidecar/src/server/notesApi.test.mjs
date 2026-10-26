import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { deleteNote, listNotes, readNote, writeNote } from './notesApi.mjs';

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

  it('reads a note with its mtime and 404s a missing one', async () => {
    assert.deepEqual(await readNote(booksRoot, 'book1', 'concepts/grace.md'), {
      ok: true,
      content: '# Grace\n',
      mtimeMs: statSync(join(notesRoot, 'concepts', 'grace.md')).mtimeMs,
    });
    assert.equal((await readNote(booksRoot, 'book1', 'concepts/none.md')).status, 404);
  });

  it('writes a note inside the package and returns its new mtime', async () => {
    const result = await writeNote(booksRoot, 'book1', 'concepts/grace.md', '# Edited\n');
    assert.deepEqual(result, {
      ok: true,
      mtimeMs: statSync(join(notesRoot, 'concepts', 'grace.md')).mtimeMs,
    });
    assert.equal(readFileSync(join(notesRoot, 'concepts', 'grace.md'), 'utf8'), '# Edited\n');
  });

  it('refuses a save when the page changed since it was read', async () => {
    const page = join(notesRoot, 'concepts', 'grace.md');
    const { mtimeMs } = await readNote(booksRoot, 'book1', 'concepts/grace.md');
    // The assistant rewrites the page while the reader is editing it.
    writeFileSync(page, '# Grace (assistant)\n');
    utimesSync(page, new Date(), new Date(mtimeMs + 5000));

    const stale = await writeNote(booksRoot, 'book1', 'concepts/grace.md', '# Mine\n', mtimeMs);
    assert.deepEqual(stale, { ok: false, status: 409, error: 'note_changed' });
    assert.equal(readFileSync(page, 'utf8'), '# Grace (assistant)\n');

    const fresh = statSync(page).mtimeMs;
    assert.equal((await writeNote(booksRoot, 'book1', 'concepts/grace.md', '# Mine\n', fresh)).ok, true);
  });

  it('deletes a page but nothing outside the package', async () => {
    assert.deepEqual(await deleteNote(booksRoot, 'book1', 'concepts/grace.md'), { ok: true });
    assert.equal(existsSync(join(notesRoot, 'concepts', 'grace.md')), false);
    assert.equal((await deleteNote(booksRoot, 'book1', 'concepts/grace.md')).status, 404);
    assert.equal((await deleteNote(booksRoot, 'book1', '../book2/index.md')).status, 400);

    // A symlinked page must not let a delete escape the notes package.
    const memory = join(booksRoot, '.wellread', 'memory');
    mkdirSync(memory, { recursive: true });
    writeFileSync(join(memory, 'reader.md'), 'keep');
    symlinkSync(join(memory, 'reader.md'), join(notesRoot, 'concepts', 'link.md'));
    assert.equal((await deleteNote(booksRoot, 'book1', 'concepts/link.md')).status, 403);
    assert.equal(readFileSync(join(memory, 'reader.md'), 'utf8'), 'keep');
  });

  it('rejects paths outside the writable OKF tree', async () => {
    for (const rel of ['../book2/index.md', 'tools/x.md', 'AGENTS.md', 'concepts/x.txt', 'other/x.md']) {
      assert.equal((await writeNote(booksRoot, 'book1', rel, 'x')).status, 400, rel);
      assert.equal((await readNote(booksRoot, 'book1', rel)).status, 400, rel);
      assert.equal((await deleteNote(booksRoot, 'book1', rel)).status, 400, rel);
    }
    assert.equal((await writeNote(booksRoot, 'book1', 'index.md', 42)).status, 400);
  });
});
