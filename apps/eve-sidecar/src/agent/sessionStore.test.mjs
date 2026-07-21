import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, after } from 'node:test';
import { createSessionStore, maybeApplyFirstTurnTitle } from './sessionStore.mjs';
import { extractSourcesFromChunkMarkdown, collectSourcesFromTools } from './prompt.mjs';

describe('sessionStore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eve-sessions-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const store = createSessionStore(dir);

  it('creates and lists sessions filtered by bookId', () => {
    const a = store.create({ bookId: 'book-a', bookTitle: 'A' });
    store.create({ bookId: 'book-b', bookTitle: 'B' });
    const listed = store.list('book-a');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, a.id);
    assert.equal(listed[0].bookId, 'book-a');
  });

  it('persists messages on save', () => {
    const s = store.create({ bookId: 'book-a', title: 't' });
    s.messages.push({
      id: 'm1',
      role: 'user',
      content: 'hello',
      createdAt: Date.now(),
    });
    store.save(s);
    const loaded = store.get(s.id);
    assert.equal(loaded.messages.length, 1);
    assert.equal(loaded.messages[0].content, 'hello');
  });
});

describe('maybeApplyFirstTurnTitle', () => {
  it('replaces the default Chat about title with a user-message prefix', () => {
    const session = {
      bookId: 'book-a',
      bookTitle: 'Moby Dick',
      title: 'Chat about Moby Dick',
    };
    assert.equal(
      maybeApplyFirstTurnTitle(session, '  Why does Ahab chase the whale?  '),
      true,
    );
    assert.equal(session.title, 'Why does Ahab chase the whale?');
  });

  it('truncates long messages to about 40 characters', () => {
    const session = {
      bookId: 'book-a',
      bookTitle: 'Moby Dick',
      title: 'Chat about Moby Dick',
    };
    const long = 'Please explain the symbolism of the white whale in great detail';
    maybeApplyFirstTurnTitle(session, long);
    assert.ok(session.title.length <= 41);
    assert.match(session.title, /…$/);
    assert.ok(session.title.startsWith('Please explain'));
  });

  it('leaves a custom title alone', () => {
    const session = {
      bookId: 'book-a',
      bookTitle: 'Moby Dick',
      title: 'My notes',
    };
    assert.equal(maybeApplyFirstTurnTitle(session, 'hello'), false);
    assert.equal(session.title, 'My notes');
  });

  it('uses the trailing question when the wire message has quote blockquotes', () => {
    const session = {
      bookId: 'book-a',
      bookTitle: 'Moby Dick',
      title: 'Chat about Moby Dick',
    };
    maybeApplyFirstTurnTitle(
      session,
      ['> selected line', '> — 《Chapter 1》', '', 'What does this mean?'].join('\n'),
    );
    assert.equal(session.title, 'What does this mean?');
  });
});

describe('extractSourcesFromChunkMarkdown', () => {
  it('parses frontmatter cfi', () => {
    const md = `---
title: "Ch"
cfi: "epubcfi(/6/2!/4/1:0)"
endCfi: "epubcfi(/6/2!/4/1:9)"
---

hi
`;
    const sources = extractSourcesFromChunkMarkdown(md, '/workspace/.wellread/extract/x/c.md');
    assert.equal(sources.length, 1);
    assert.equal(sources[0].cfi, 'epubcfi(/6/2!/4/1:0)');
    assert.equal(sources[0].title, 'Ch');
  });

  it('parses JSON-escaped titles that contain quotes', () => {
    const title = 'She said "hello"';
    const cfi = 'epubcfi(/6/2!/4/1:0)';
    const md = `---
title: ${JSON.stringify(title)}
cfi: ${JSON.stringify(cfi)}
---

body
`;
    const sources = extractSourcesFromChunkMarkdown(md);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].title, title);
    assert.equal(sources[0].cfi, cfi);
  });
});

describe('collectSourcesFromTools', () => {
  it('dedupes cfi from read_file results', () => {
    const md = `---
cfi: "epubcfi(/6/2!/4/1:0)"
title: "T"
---
body`;
    const sources = collectSourcesFromTools([
      { name: 'read_file', result: { path: '/a.md', content: md } },
      { name: 'read_file', result: { path: '/a.md', content: md } },
      { name: 'grep', result: { hits: [] } },
    ]);
    assert.equal(sources.length, 1);
  });
});
