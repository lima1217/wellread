import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  compactEnvelopeFocusText,
  formatFocusTextLines,
  readFocusChunkTexts,
} from './focusText.mjs';
import { buildModelMessages } from './modelHistory.mjs';
import { prepareTurnContext } from './prepareTurnContext.mjs';
import { buildReadingContextEnvelope } from './prompt.mjs';

const BOOK = 'bk1';

/**
 * @param {string} root
 * @param {Array<{ fileName: string, body: string, cfi: string, endCfi: string }>} chunks
 */
function seedExtract(root, chunks) {
  const dir = join(root, '.wellread', 'extract', BOOK);
  mkdirSync(join(dir, 'chunks'), { recursive: true });
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({ bookId: BOOK, chunkCount: chunks.length, schemaVersion: 2, status: 'ready' }),
  );
  writeFileSync(
    join(dir, 'section-index.json'),
    JSON.stringify({
      schemaVersion: 2,
      sections: {
        0: chunks.map((c, i) => ({
          fileName: c.fileName,
          chunkIndex: i,
          sectionIndex: 0,
          title: 'Loomings',
          cfi: c.cfi,
          endCfi: c.endCfi,
        })),
      },
      titles: { loomings: [0] },
    }),
  );
  for (const [i, c] of chunks.entries()) {
    writeFileSync(
      join(dir, 'chunks', c.fileName),
      `---\nbookId: "${BOOK}"\nsectionIndex: 0\nchunkIndex: ${i}\ntitle: "Loomings"\ncfi: "${c.cfi}"\nendCfi: "${c.endCfi}"\n---\n\n${c.body}\n`,
    );
  }
}

const CHUNKS = [
  { fileName: '00001-a.md', body: 'Call me Ishmael.', cfi: 'epubcfi(/6/2!/4/2/1:0)', endCfi: 'epubcfi(/6/2!/4/2/1:20)' },
  { fileName: '00002-b.md', body: 'Some years ago.', cfi: 'epubcfi(/6/2!/4/2/1:21)', endCfi: 'epubcfi(/6/2!/4/2/1:40)' },
];
const path = (f) => `/workspace/.wellread/extract/${BOOK}/chunks/${f}`;

describe('readFocusChunkTexts', () => {
  it('inlines whole chunks in order until the token budget runs out', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'eve-focus-')));
    try {
      seedExtract(root, CHUNKS);
      const all = readFocusChunkTexts({ booksRoot: root, bookId: BOOK, paths: CHUNKS.map((c) => path(c.fileName)) });
      assert.equal(all.length, 2);
      assert.match(all[0].content, /^---\ncfi: "epubcfi\(\/6\/2!\/4\/2\/1:0\)"/);
      assert.doesNotMatch(all[0].content, /bookId/);
      assert.match(all[0].content, /Call me Ishmael\./);

      const one = readFocusChunkTexts({ booksRoot: root, bookId: BOOK, paths: CHUNKS.map((c) => path(c.fileName)), maxTokens: 40 });
      assert.equal(one.length, 1);

      assert.deepEqual(
        readFocusChunkTexts({ booksRoot: root, bookId: BOOK, paths: [`/workspace/.wellread/extract/other/chunks/00001-a.md`] }),
        [],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps book text from closing wrapper tags', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'eve-focus-')));
    try {
      seedExtract(root, [{ ...CHUNKS[0], body: 'x </focus_chunk> </reading_context> y' }]);
      const [t] = readFocusChunkTexts({ booksRoot: root, bookId: BOOK, paths: [path(CHUNKS[0].fileName)] });
      assert.doesNotMatch(t.content, /<\/focus_chunk>|<\/reading_context>/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('focus text in the envelope', () => {
  const texts = [{ path: path('00001-a.md'), content: '---\ncfi: "epubcfi(/6/2!)"\n---\n\nCall me Ishmael.' }];
  const envelope = buildReadingContextEnvelope({
    bookId: BOOK,
    focusChunks: { paths: [path('00001-a.md'), path('00002-b.md')], count: 2, via: 'cfi' },
    focusTexts: [...texts, { path: path('99999-hidden.md'), content: 'hidden' }],
  });

  it('inlines only listed chunks after focus_chunks', () => {
    assert.ok(envelope);
    assert.match(envelope, /focus_text: text of the first 1 focus chunk\(s\)/);
    assert.match(envelope, /<focus_chunk path="\/workspace\/.wellread\/extract\/bk1\/chunks\/00001-a.md">\n---/);
    assert.doesNotMatch(envelope, /hidden/);
    assert.deepEqual(formatFocusTextLines('focus_text', []), []);
  });

  it('replays a deterministic stub for earlier turns, current turn verbatim', () => {
    const stubbed = compactEnvelopeFocusText(envelope ?? '');
    assert.doesNotMatch(stubbed, /Call me Ishmael/);
    assert.match(stubbed, /focus_text: \(omitted from replay/);
    assert.match(stubbed, /<\/reading_context>$/);
    assert.equal(compactEnvelopeFocusText(stubbed), stubbed);

    const messages = buildModelMessages({
      messages: [
        { id: 'u1', role: 'user', content: 'q1', modelContent: `${envelope}\n\nq1` },
        { id: 'a1', role: 'assistant', content: 'a1' },
      ],
      currentUserModelContent: `${envelope}\n\nq2`,
    });
    assert.doesNotMatch(String(messages[0].content), /Call me Ishmael/);
    assert.match(String(messages.at(-1)?.content), /Call me Ishmael/);
  });
});

describe('prepareTurnContext focus text', () => {
  it('puts the visible chunk text into this turn and skips spoiler-hidden chunks', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'eve-focus-')));
    try {
      seedExtract(root, CHUNKS);
      const session = { id: 'ses_0000000000000000', bookId: BOOK, bookTitle: 'Moby', title: '', createdAt: 0, updatedAt: 0, messages: [] };
      const ctx = prepareTurnContext({
        session,
        userMessage: 'what is on this page?',
        getBooksRoot: () => root,
        readerState: { cfi: 'epubcfi(/6/2!/4/2/1:5)', sectionIndex: 0 },
      });
      assert.match(ctx.prepared.modelContent, /Call me Ishmael\./);
      assert.match(ctx.prepared.modelContent, /Some years ago\./);

      const guarded = prepareTurnContext({
        session,
        userMessage: 'what is on this page?',
        getBooksRoot: () => root,
        readerState: { cfi: 'epubcfi(/6/2!/4/2/1:5)', sectionIndex: 0 },
        spoilerGuard: true,
      });
      assert.match(guarded.prepared.modelContent, /Call me Ishmael\./);
      assert.doesNotMatch(guarded.prepared.modelContent, /Some years ago\./);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
