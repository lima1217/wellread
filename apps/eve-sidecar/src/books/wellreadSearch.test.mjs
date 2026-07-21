import assert from 'node:assert/strict';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { globWellread, grepWellread } from './wellreadSearch.mjs';

describe('grepWellread pattern safety', () => {
  it('rejects patterns longer than 256 characters with a structured error', () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-grep-')));
    try {
      mkdirSync(join(booksRoot, '.wellread'), { recursive: true });
      writeFileSync(join(booksRoot, '.wellread', 'a.md'), 'hello\n');
      assert.throws(
        () => grepWellread(booksRoot, 'x'.repeat(257)),
        (err) =>
          err instanceof Error &&
          err.message.startsWith('invalid_grep_pattern:') &&
          /too long/i.test(err.message),
      );
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('rejects illegal regex with a structured error (no uncaught throw)', () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-grep-')));
    try {
      mkdirSync(join(booksRoot, '.wellread'), { recursive: true });
      writeFileSync(join(booksRoot, '.wellread', 'a.md'), 'hello\n');
      assert.throws(
        () => grepWellread(booksRoot, '(unclosed'),
        (err) =>
          err instanceof Error && err.message.startsWith('invalid_grep_pattern:'),
      );
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });
});

describe('wellreadSearch symlink confinement', () => {
  it('glob and grep do not follow symlinks out of .wellread', () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-search-')));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-out-')));
    try {
      mkdirSync(join(booksRoot, '.wellread'), { recursive: true });
      writeFileSync(join(booksRoot, '.wellread', 'safe.md'), 'SAFE_IN_WELLREAD\n');
      writeFileSync(join(outside, 'secret.txt'), 'OUTSIDE_SECRET\n');
      writeFileSync(join(booksRoot, 'book-secret.txt'), 'BOOKS_ROOT_SECRET\n');
      symlinkSync(outside, join(booksRoot, '.wellread', 'out'));
      symlinkSync('..', join(booksRoot, '.wellread', 'up'));

      const hits = globWellread(booksRoot, '**/*');
      assert.deepEqual(
        hits.map((h) => h.path).sort(),
        ['/workspace/.wellread/safe.md'],
      );

      assert.deepEqual(grepWellread(booksRoot, 'OUTSIDE_SECRET'), []);
      assert.deepEqual(grepWellread(booksRoot, 'BOOKS_ROOT_SECRET'), []);
      assert.equal(grepWellread(booksRoot, 'SAFE_IN_WELLREAD').length, 1);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
