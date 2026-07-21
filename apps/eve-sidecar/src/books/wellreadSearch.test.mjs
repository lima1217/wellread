import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { grepWellread } from './wellreadSearch.mjs';

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
