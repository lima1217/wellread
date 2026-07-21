import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createBooksFsSession } from './booksFsSession.mjs';
import { createNodeRealpathLookup } from './nodeLookup.mjs';
import { WORKSPACE_ROOT, authorizeWrite } from './scopedFs.mjs';

describe('scopedFs', () => {
  it('WORKSPACE_ROOT is /workspace', () => {
    assert.equal(WORKSPACE_ROOT, '/workspace');
  });

  it('authorizeWrite rejects paths outside .wellread', () => {
    const booksRoot = mkdtempSync(join(tmpdir(), 'wellread-books-'));
    try {
      const lookup = createNodeRealpathLookup();
      const result = authorizeWrite('/workspace/book.epub', booksRoot, lookup);
      assert.equal(result.ok, false);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });
});

describe('createBooksFsSession', () => {
  it('write/read roundtrip in temp dir', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-books-')));
    try {
      const session = createBooksFsSession({ getBooksRoot: () => booksRoot });
      const content = new TextEncoder().encode('hello');
      await session.writeFile({ path: '.wellread/test.txt', content });
      const read = await session.readFile({ path: '.wellread/test.txt' });
      assert.deepEqual(read, content);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('does not mkdir outside Books via a .wellread symlink before rejecting write', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-books-')));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-outside-')));
    try {
      mkdirSync(join(booksRoot, '.wellread'), { recursive: true });
      symlinkSync(outside, join(booksRoot, '.wellread', 'link'));
      const session = createBooksFsSession({ getBooksRoot: () => booksRoot });
      const content = new TextEncoder().encode('nope');
      await assert.rejects(
        () =>
          session.writeFile({
            path: '.wellread/link/a/b/x.md',
            content,
          }),
      );
      assert.equal(
        existsSync(join(outside, 'a')),
        false,
        'must not create directories outside Books before authorizeWrite',
      );
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
