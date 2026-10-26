import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, after } from 'node:test';
import {
  createSessionStore,
  isSafeSessionId,
  maybeApplyFirstTurnTitle,
  normalizeSession,
  truncateSessionFrom,
} from './sessionStore.mjs';
import {
  collectSourcesFromTools,
  extractSourcesFromChunkMarkdown,
} from './extractChunk.mjs';

describe('normalizeSession', () => {
  it('drops corrupt messages and keeps the minimum valid shape', () => {
    const session = normalizeSession({
      id: 'ses_0123456789abcdef',
      bookId: 'book-a',
      reasoningDialect: 'deepseek',
      messages: [
        { id: 'm1', role: 'user', content: 'hi', createdAt: 1 },
        { id: 'bad', role: 'tool', content: 'nope', createdAt: 2 },
        { role: 'assistant', content: 'missing id', createdAt: 3 },
        null,
        { id: 'm2', role: 'assistant', content: 'ok', createdAt: 4, compacted: true },
      ],
    });
    assert.ok(session);
    assert.equal(session.messages.length, 2);
    assert.equal(session.messages[0].id, 'm1');
    assert.equal(session.messages[1].compacted, true);
    assert.equal(session.reasoningDialect, 'deepseek');
  });

  it('keeps only valid reasoningDialect values and drops the rest', () => {
    assert.equal(normalizeSession({ id: 'ses_0123456789abcdef', bookId: 'a', messages: [], reasoningDialect: 'openai' }).reasoningDialect, 'openai');
    assert.equal(normalizeSession({ id: 'ses_0123456789abcdef', bookId: 'a', messages: [], reasoningDialect: 'glm' }).reasoningDialect, undefined);
  });

  it('keeps the dialect host key when it is a string and drops it otherwise', () => {
    const withHost = normalizeSession({
      id: 'ses_0123456789abcdef',
      bookId: 'a',
      messages: [],
      reasoningDialect: 'deepseek',
      reasoningDialectBaseURL: 'https://api.deepseek.com/v1',
    });
    assert.equal(withHost.reasoningDialect, 'deepseek');
    assert.equal(withHost.reasoningDialectBaseURL, 'https://api.deepseek.com/v1');

    const badHost = normalizeSession({
      id: 'ses_0123456789abcdef',
      bookId: 'a',
      messages: [],
      reasoningDialect: 'deepseek',
      reasoningDialectBaseURL: 42,
    });
    assert.equal(badHost.reasoningDialect, 'deepseek');
    assert.equal(badHost.reasoningDialectBaseURL, undefined);
  });

  it('normalizes persisted web_search_call items and drops malformed ones', () => {
    const session = normalizeSession({
      id: 'ses_0123456789abcdef',
      bookId: 'a',
      messages: [],
      webSearchCalls: [
        {
          type: 'web_search_call',
          id: 'ws_1',
          status: 'completed',
          action: { type: 'search', query: 'q1', results: [] },
        },
        { type: 'web_search_call', id: 'ws_2', status: 'completed' },
        { type: 'reasoning', id: 'rs_1' },
        { id: 'ws_bad' },
        null,
      ],
    });
    assert.deepEqual(session.webSearchCalls, [
      {
        type: 'web_search_call',
        id: 'ws_1',
        status: 'completed',
        action: { type: 'search', query: 'q1', results: [] },
      },
      { type: 'web_search_call', id: 'ws_2', status: 'completed' },
    ]);
  });
});

describe('isSafeSessionId', () => {
  it('accepts create()-shaped ids', () => {
    assert.equal(isSafeSessionId('ses_0123456789abcdef'), true);
  });

  it('rejects path traversal and non-hex shapes', () => {
    assert.equal(isSafeSessionId('../anything'), false);
    assert.equal(isSafeSessionId('..%2F..%2Fanything'), false);
    assert.equal(isSafeSessionId('ses_../x'), false);
    assert.equal(isSafeSessionId('ses_0123456789ABCDEF'), false);
    assert.equal(isSafeSessionId('ses_0123456789abcde'), false);
    assert.equal(isSafeSessionId('ses_0123456789abcdef0'), false);
    assert.equal(isSafeSessionId(''), false);
    assert.equal(isSafeSessionId(null), false);
  });
});

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
    assert.equal(isSafeSessionId(a.id), true);
  });

  it('list reuses cached metadata until the file changes', () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'eve-list-cache-'));
    try {
      const cached = createSessionStore(cacheDir);
      const s = cached.create({ bookId: 'book-c', title: 'first' });
      // Whole-second mtime so it can be restored exactly below.
      const file = join(cacheDir, 'sessions', `${s.id}.json`);
      utimesSync(file, 1_700_000_000, 1_700_000_000);
      assert.equal(cached.list('book-c')[0].title, 'first');

      // Same size + mtime as before: list must not re-read the transcript.
      writeFileSync(file, 'x'.repeat(statSync(file).size));
      utimesSync(file, 1_700_000_000, 1_700_000_000);
      assert.equal(cached.list('book-c')[0]?.title, 'first');

      // Store writes invalidate the entry.
      s.title = 'second';
      cached.save(s);
      assert.equal(cached.list('book-c')[0].title, 'second');

      cached.remove(s.id);
      assert.equal(cached.list('book-c').length, 0);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
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

  it('refuses traversal ids without touching the filesystem path', () => {
    assert.equal(store.get('../escape'), null);
    assert.equal(store.get('ses_../escape'), null);
    assert.equal(store.remove('../../etc/passwd'), false);
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

describe('truncateSessionFrom', () => {
  function sessionWith(ids) {
    return {
      id: 'ses_0123456789abcdef',
      bookId: 'book-a',
      title: 't',
      createdAt: 1,
      updatedAt: 1,
      lastContextTokens: 900,
      messages: ids.map((id, i) => ({
        id,
        role: id.startsWith('u') ? 'user' : 'assistant',
        content: id,
        createdAt: i,
      })),
    };
  }

  it('drops the target user turn and the tail; restore puts it back once', () => {
    const session = sessionWith(['u1', 'a1', 'u2', 'a2']);
    const truncation = truncateSessionFrom(session, 'u2');
    assert.ok(truncation);
    assert.deepEqual(
      session.messages.map((m) => m.id),
      ['u1', 'a1'],
    );
    assert.equal(session.lastContextTokens, undefined);

    truncation.restore();
    truncation.restore();
    assert.deepEqual(
      session.messages.map((m) => m.id),
      ['u1', 'a1', 'u2', 'a2'],
    );
    assert.equal(session.lastContextTokens, 900);
  });

  it('returns null and leaves the session alone for unknown or assistant targets', () => {
    const session = sessionWith(['u1', 'a1']);
    assert.equal(truncateSessionFrom(session, 'nope'), null);
    assert.equal(truncateSessionFrom(session, 'a1'), null);
    assert.equal(session.messages.length, 2);
    assert.equal(session.lastContextTokens, 900);
  });
});
