import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createToolParallelBudget } from './toolParallelBudget.mjs';
import {
  GREP_LINE_TEXT_MAX,
  authorizeOkfNotesWrite,
  createReadingTools,
  projectGrepHitForModel,
} from './tools.mjs';
import { projectExtractContentForModel } from './extractChunk.mjs';

/**
 * @param {string} booksRoot
 * @param {string} [bookId]
 */
function readingContext(booksRoot, bookId = 'bk1') {
  const parallelBudget = createToolParallelBudget();
  parallelBudget.beginStep();
  return { bookId, booksRoot, parallelBudget };
}

/**
 * @param {string} booksRoot
 * @param {string} toolCallId
 * @param {string} [bookId]
 */
function execOpts(booksRoot, toolCallId, bookId = 'bk1') {
  return {
    toolCallId,
    messages: [],
    context: readingContext(booksRoot, bookId),
  };
}

describe('projectExtractContentForModel', () => {
  it('keeps cfi/title/endCfi/sectionIndex/chunkIndex and drops bookId', () => {
    const raw = `---
bookId: "bk1"
sectionIndex: 3
title: "Loomings"
cfi: "epubcfi(/6/2!)"
endCfi: "epubcfi(/6/2!/4)"
chunkIndex: 0
---

Call me Ishmael.
`;
    const out = projectExtractContentForModel(raw);
    assert.match(
      out,
      /^---\ncfi: "epubcfi\(\/6\/2!\)"\ntitle: "Loomings"\nendCfi: "epubcfi\(\/6\/2!\/4\)"\nsectionIndex: 3\nchunkIndex: 0\n---\n/,
    );
    assert.match(out, /Call me Ishmael/);
    assert.doesNotMatch(out, /bookId/);
  });

  it('leaves non-frontmatter content unchanged', () => {
    assert.equal(projectExtractContentForModel('plain'), 'plain');
  });

  it('still yields sources via extractSourcesFromChunkMarkdown', async () => {
    const { extractSourcesFromChunkMarkdown } = await import('./extractChunk.mjs');
    const raw = `---
bookId: "bk1"
title: "Loomings"
cfi: "epubcfi(/6/2!)"
endCfi: "epubcfi(/6/2!/4)"
chunkIndex: 0
---

Body.
`;
    const projected = projectExtractContentForModel(raw);
    const sources = extractSourcesFromChunkMarkdown(projected, '/workspace/x.md');
    assert.equal(sources.length, 1);
    assert.equal(sources[0].cfi, 'epubcfi(/6/2!)');
    assert.equal(sources[0].title, 'Loomings');
  });
});

describe('projectGrepHitForModel', () => {
  it('truncates long line text', () => {
    const long = 'a'.repeat(GREP_LINE_TEXT_MAX + 20);
    const hit = projectGrepHitForModel({
      path: '/workspace/.wellread/extract/bk/a.md',
      line: 4,
      text: long,
    });
    assert.equal(hit.line, 4);
    assert.equal(hit.text.length, GREP_LINE_TEXT_MAX);
    assert.equal(hit.text.endsWith('…'), true);
  });
});

describe('authorizeOkfNotesWrite', () => {
  const bookId = 'bk1';

  it('allows OKF root spine and concept-first pages', () => {
    for (const path of [
      `/workspace/.wellread/notes/${bookId}/index.md`,
      `/workspace/.wellread/notes/${bookId}/log.md`,
      `/workspace/.wellread/notes/${bookId}/concepts/网络效应.md`,
      `/workspace/.wellread/notes/${bookId}/chapters/index.md`,
    ]) {
      const r = authorizeOkfNotesWrite(path, bookId);
      assert.equal(r.ok, true, path);
      assert.equal(r.path, path);
    }
  });

  it('rejects extract, other books, AGENTS/tools, and unknown dirs', () => {
    assert.equal(
      authorizeOkfNotesWrite(`/workspace/.wellread/extract/${bookId}/a.md`, bookId).error,
      'denied',
    );
    assert.equal(
      authorizeOkfNotesWrite('/workspace/.wellread/notes/other/index.md', bookId).error,
      'denied',
    );
    assert.equal(
      authorizeOkfNotesWrite(`/workspace/.wellread/notes/${bookId}/summary.md`, bookId).error,
      'denied',
    );
    assert.equal(
      authorizeOkfNotesWrite(`/workspace/.wellread/notes/${bookId}/AGENTS.md`, bookId).error,
      'denied',
    );
    assert.equal(
      authorizeOkfNotesWrite(
        `/workspace/.wellread/notes/${bookId}/tools/validate_okf_wiki.py`,
        bookId,
      ).error,
      'denied',
    );
    assert.equal(
      authorizeOkfNotesWrite(`/workspace/.wellread/notes/${bookId}/entities/x.md`, bookId).error,
      'denied',
    );
    assert.equal(authorizeOkfNotesWrite(`/workspace/.wellread/notes/${bookId}`, bookId).ok, false);
    assert.equal(authorizeOkfNotesWrite(`/workspace/.wellread/notes/${bookId}/index.md`, '').ok, false);
    assert.equal(
      authorizeOkfNotesWrite(`/workspace/.wellread/notes/../evil/index.md`, '../evil').ok,
      false,
    );
  });
});

function writeExtractMeta(booksRoot, bookId, chunkCount = 1) {
  const dir = join(booksRoot, '.wellread', 'extract', bookId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      bookId,
      sourceHash: 'h',
      sourceMtimeMs: 1,
      format: 'EPUB',
      extractedAt: 1,
      chunkCount,
      schemaVersion: 2,
      status: 'ready',
    }),
  );
}

describe('createReadingTools envelopes', () => {
  it('describes glob/grep by role without wide-path examples', () => {
    const tools = createReadingTools();
    assert.match(tools.glob.description, /List file paths/i);
    assert.match(tools.glob.description, /resolve_section/);
    assert.match(tools.grep.description, /file contents/i);
    assert.match(tools.resolve_section.description, /sectionIndex/i);
    assert.equal(
      tools.glob.inputSchema.shape.pattern.description,
      'Glob path pattern under /workspace/.wellread/',
    );
    assert.doesNotMatch(tools.glob.description, /\*\*\/\*\*/);
    assert.doesNotMatch(
      tools.glob.inputSchema.shape.pattern.description ?? '',
      /\*\*\/\*\*/,
    );
  });

  it('resolve_section returns ordered chunk paths for a sectionIndex', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'eve-tools-resolve-')));
    const bookId = 'bk1';
    try {
      const chunks = join(booksRoot, '.wellread', 'extract', bookId, 'chunks');
      mkdirSync(chunks, { recursive: true });
      writeExtractMeta(booksRoot, bookId, 2);
      writeFileSync(
        join(chunks, '00002-b.md'),
        `---
sectionIndex: 4
chunkIndex: 2
title: "B"
cfi: "epubcfi(/6/2!)"
---

b
`,
      );
      writeFileSync(
        join(chunks, '00001-a.md'),
        `---
sectionIndex: 4
chunkIndex: 1
title: "A"
cfi: "epubcfi(/6/2!)"
---

a
`,
      );
      const tools = createReadingTools();
      const hit = await tools.resolve_section.execute(
        { sectionIndex: 4 },
        execOpts(booksRoot, 'rs1', bookId),
      );
      assert.equal(hit.ok, true);
      assert.equal(hit.via, 'sectionIndex');
      assert.equal(hit.count, 2);
      assert.deepEqual(hit.paths, [
        `/workspace/.wellread/extract/${bookId}/chunks/00001-a.md`,
        `/workspace/.wellread/extract/${bookId}/chunks/00002-b.md`,
      ]);

      const byTitle = await tools.resolve_section.execute(
        { title: 'A' },
        execOpts(booksRoot, 'rs2', bookId),
      );
      assert.equal(byTitle.ok, true);
      assert.equal(byTitle.count, 1);

      const missing = await tools.resolve_section.execute(
        {},
        execOpts(booksRoot, 'rs3', bookId),
      );
      assert.equal(missing.ok, false);
      assert.equal(missing.error, 'invalid_args');
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('write_file succeeds inside OKF package and soft-rejects outside', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'eve-tools-notes-')));
    const bookId = 'bk1';
    try {
      const tools = createReadingTools();
      const notesPath = `/workspace/.wellread/notes/${bookId}/concepts/测试.md`;
      const writeOk = await tools.write_file.execute(
        { path: notesPath, content: '---\ntype: Concept\n---\n\nbody\n' },
        execOpts(booksRoot, 't1', bookId),
      );
      assert.equal(writeOk.ok, true);
      assert.equal(writeOk.path, notesPath);
      const host = join(booksRoot, '.wellread', 'notes', bookId, 'concepts', '测试.md');
      assert.match(readFileSync(host, 'utf8'), /body/);

      const denied = await tools.write_file.execute(
        {
          path: `/workspace/.wellread/extract/${bookId}/chunk.md`,
          content: 'nope',
        },
        execOpts(booksRoot, 't2', bookId),
      );
      assert.equal(denied.ok, false);
      assert.equal(denied.error, 'denied');

      const agents = await tools.write_file.execute(
        {
          path: `/workspace/.wellread/notes/${bookId}/AGENTS.md`,
          content: 'poison',
        },
        execOpts(booksRoot, 't3', bookId),
      );
      assert.equal(agents.ok, false);
      assert.equal(agents.error, 'denied');
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('write_file refuses symlink escape out of notes/<bookId>', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'eve-tools-symlink-')));
    const bookId = 'bk1';
    try {
      const notes = join(booksRoot, '.wellread', 'notes', bookId);
      const extract = join(booksRoot, '.wellread', 'extract', bookId);
      mkdirSync(extract, { recursive: true });
      mkdirSync(notes, { recursive: true });
      symlinkSync(extract, join(notes, 'concepts'));
      const tools = createReadingTools();
      const result = await tools.write_file.execute(
        {
          path: `/workspace/.wellread/notes/${bookId}/concepts/evil.md`,
          content: 'pwn',
        },
        execOpts(booksRoot, 't4', bookId),
      );
      assert.equal(result.ok, false);
      assert.equal(result.error, 'denied');
      assert.equal(existsSyncSafe(join(extract, 'evil.md')), false);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('read_file returns ok envelope for hit and miss', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'eve-tools-read-')));
    const bookId = 'bk1';
    try {
      const rel = join('.wellread', 'extract', bookId);
      mkdirSync(join(booksRoot, rel), { recursive: true });
      writeExtractMeta(booksRoot, bookId, 1);
      writeFileSync(join(booksRoot, rel, 'a.md'), 'hello\n');
      const tools = createReadingTools();

      const hit = await tools.read_file.execute(
        { path: `/workspace/.wellread/extract/${bookId}/a.md` },
        execOpts(booksRoot, 'r1', bookId),
      );
      assert.equal(hit.ok, true);
      assert.equal(hit.content, 'hello\n');

      const miss = await tools.read_file.execute(
        { path: `/workspace/.wellread/extract/${bookId}/missing.md` },
        execOpts(booksRoot, 'r2', bookId),
      );
      assert.equal(miss.ok, false);
      assert.equal(miss.error, 'not_found');
      assert.equal(miss.content, undefined);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('resolve_section soft-fails with extract_not_ready when meta is missing', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'eve-tools-noready-')));
    try {
      const tools = createReadingTools();
      const hit = await tools.resolve_section.execute(
        { sectionIndex: 0 },
        execOpts(booksRoot, 'rs0'),
      );
      assert.equal(hit.ok, false);
      assert.equal(hit.error, 'extract_not_ready');
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('soft-fails when parallelBudget is exhausted via toolsContext', async () => {
    const tools = createReadingTools();
    const parallelBudget = createToolParallelBudget();
    parallelBudget.beginStep();
    for (let i = 0; i < 8; i += 1) {
      assert.equal(parallelBudget.tryConsume('read_file').ok, true);
    }
    const denied = await tools.read_file.execute(
      { path: '/workspace/.wellread/extract/bk1/a.md' },
      {
        toolCallId: 'r_over',
        messages: [],
        context: { bookId: 'bk1', booksRoot: '/tmp', parallelBudget },
      },
    );
    assert.equal(denied.ok, false);
    assert.equal(denied.error, 'too_many_parallel_tools');
  });
});

function existsSyncSafe(p) {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}
