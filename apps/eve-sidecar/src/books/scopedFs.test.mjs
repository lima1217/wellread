import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { setBundledSkillsRootForTests } from '../agent/skills/bundledRoot.mjs';
import { createBooksFsSession } from './booksFsSession.mjs';
import { createNodeRealpathLookup } from './nodeLookup.mjs';
import { WORKSPACE_ROOT, authorizeWrite } from './scopedFs.mjs';

afterEach(() => {
  setBundledSkillsRootForTests(undefined);
});

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

  it('readFile falls back to bundled SKILL.md for catalog paths', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-books-')));
    const bundledRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-bundled-')));
    try {
      setBundledSkillsRootForTests(bundledRoot);
      mkdirSync(join(bundledRoot, 'translate'), { recursive: true });
      writeFileSync(
        join(bundledRoot, 'translate', 'SKILL.md'),
        '---\nname: Translate\ndescription: Zh\n---\n译成中文。\n',
      );
      const session = createBooksFsSession({ getBooksRoot: () => booksRoot });
      const bytes = await session.readFile({ path: '/workspace/skills/translate/SKILL.md' });
      assert.ok(bytes);
      assert.match(new TextDecoder().decode(bytes), /译成中文/);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
      rmSync(bundledRoot, { recursive: true, force: true });
    }
  });

  it('readFile serves bundled package siblings such as PACKAGE.md', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-books-')));
    const bundledRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-bundled-')));
    try {
      setBundledSkillsRootForTests(bundledRoot);
      mkdirSync(join(bundledRoot, 'note'), { recursive: true });
      writeFileSync(
        join(bundledRoot, 'note', 'SKILL.md'),
        '---\nname: note\ndescription: OKF notes\n---\nBody.\n',
      );
      writeFileSync(join(bundledRoot, 'note', 'PACKAGE.md'), '# PACKAGE\nTree here.\n');
      const session = createBooksFsSession({ getBooksRoot: () => booksRoot });
      const bytes = await session.readFile({ path: '/workspace/skills/note/PACKAGE.md' });
      assert.ok(bytes);
      assert.match(new TextDecoder().decode(bytes), /Tree here/);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
      rmSync(bundledRoot, { recursive: true, force: true });
    }
  });

  it('readFile ignores user PACKAGE.md overlay and serves bundled', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-books-')));
    const bundledRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-bundled-')));
    try {
      setBundledSkillsRootForTests(bundledRoot);
      mkdirSync(join(bundledRoot, 'note'), { recursive: true });
      writeFileSync(
        join(bundledRoot, 'note', 'SKILL.md'),
        '---\nname: note\ndescription: OKF notes\n---\nBody.\n',
      );
      writeFileSync(join(bundledRoot, 'note', 'PACKAGE.md'), '# PACKAGE\nBundled tree.\n');
      mkdirSync(join(booksRoot, 'skills', 'note'), { recursive: true });
      writeFileSync(
        join(booksRoot, 'skills', 'note', 'SKILL.md'),
        '---\nname: note\ndescription: user\n---\nUser skill.\n',
      );
      writeFileSync(join(booksRoot, 'skills', 'note', 'PACKAGE.md'), '# PACKAGE\nPOISON\n');
      const session = createBooksFsSession({ getBooksRoot: () => booksRoot });
      const bytes = await session.readFile({ path: '/workspace/skills/note/PACKAGE.md' });
      assert.ok(bytes);
      const text = new TextDecoder().decode(bytes);
      assert.match(text, /Bundled tree/);
      assert.doesNotMatch(text, /POISON/);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
      rmSync(bundledRoot, { recursive: true, force: true });
    }
  });

  it('readFile ignores unparseable user SKILL.md and serves bundled', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-books-')));
    const bundledRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-bundled-')));
    try {
      setBundledSkillsRootForTests(bundledRoot);
      mkdirSync(join(bundledRoot, 'translate'), { recursive: true });
      writeFileSync(
        join(bundledRoot, 'translate', 'SKILL.md'),
        '---\nname: Translate\ndescription: Bundled\n---\nBUNDLED_BODY\n',
      );
      mkdirSync(join(booksRoot, 'skills', 'translate'), { recursive: true });
      writeFileSync(join(booksRoot, 'skills', 'translate', 'SKILL.md'), 'not valid skill md\n');
      const session = createBooksFsSession({ getBooksRoot: () => booksRoot });
      const bytes = await session.readFile({ path: '/workspace/skills/translate/SKILL.md' });
      assert.ok(bytes);
      assert.match(new TextDecoder().decode(bytes), /BUNDLED_BODY/);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
      rmSync(bundledRoot, { recursive: true, force: true });
    }
  });
});
