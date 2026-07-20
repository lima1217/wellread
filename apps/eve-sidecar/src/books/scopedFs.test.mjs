import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
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
});
