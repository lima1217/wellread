import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createMcpServer } from './mcp.mjs';
import { createReaderLiveStore, normalizeReaderLive } from './readerLive.mjs';

/** Two sections, two chunks each (same shape as spoilerGuard.test.mjs). */
function seedBook() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'eve-mcp-')));
  const ex = join(root, '.wellread', 'extract', 'bk1');
  mkdirSync(join(ex, 'chunks'), { recursive: true });
  writeFileSync(
    join(ex, 'meta.json'),
    JSON.stringify({ bookId: 'bk1', chunkCount: 4, schemaVersion: 2, status: 'ready' }),
  );
  const rows = [
    ['00001-a.md', 0, 0, 'epubcfi(/6/2!/4/2/1:0)', 'epubcfi(/6/2!/4/2/1:50)', 'Ishmael goes to sea.'],
    ['00002-b.md', 1, 0, 'epubcfi(/6/2!/4/4/1:0)', 'epubcfi(/6/2!/4/4/1:50)', 'He meets Queequeg.'],
    ['00003-c.md', 2, 1, 'epubcfi(/6/4!/4/2/1:0)', 'epubcfi(/6/4!/4/2/1:50)', 'The whale sinks the ship.'],
    ['00004-d.md', 3, 1, 'epubcfi(/6/4!/4/4/1:0)', 'epubcfi(/6/4!/4/4/1:50)', 'Only Ishmael survives.'],
  ];
  const sections = {};
  for (const [fileName, chunkIndex, sectionIndex, cfi, endCfi, body] of rows) {
    writeFileSync(
      join(ex, 'chunks', String(fileName)),
      `---\nsectionIndex: ${sectionIndex}\nchunkIndex: ${chunkIndex}\ntitle: "S${sectionIndex}"\ncfi: "${cfi}"\nendCfi: "${endCfi}"\n---\n\n${body}\n`,
    );
    (sections[String(sectionIndex)] ??= []).push({
      fileName,
      chunkIndex,
      sectionIndex,
      title: `S${sectionIndex}`,
      cfi,
      endCfi,
    });
  }
  writeFileSync(
    join(ex, 'section-index.json'),
    JSON.stringify({ schemaVersion: 2, sections, titles: { s0: [0], s1: [1] } }),
  );
  return root;
}

function setup(liveBody, runReaderCommand) {
  const root = seedBook();
  const live = createReaderLiveStore();
  if (liveBody) live.set(normalizeReaderLive(liveBody));
  const server = createMcpServer({ getBooksRoot: () => root, getLive: live.get, runReaderCommand });
  let id = 0;
  const rpc = (method, params) => server.handleMessage({ jsonrpc: '2.0', id: ++id, method, params });
  const call = async (name, args = {}) => {
    const res = await rpc('tools/call', { name, arguments: args });
    return res.result;
  };
  return { root, live, server, rpc, call, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const reading = {
  bookId: 'bk1',
  bookTitle: 'Moby-Dick',
  readerState: { chapter: 'S0', cfi: 'epubcfi(/6/2!/4/2/1:10)', sectionIndex: 0 },
};

describe('MCP server', () => {
  it('initializes with instructions and echoes a supported protocol version', async () => {
    const t = setup();
    try {
      const res = await t.rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {} });
      assert.equal(res.result.protocolVersion, '2025-03-26');
      assert.equal(res.result.serverInfo.name, 'wellread');
      assert.deepEqual(res.result.capabilities, { tools: {}, prompts: {} });
      assert.match(res.result.instructions, /get_reading_state/);
      assert.match(res.result.instructions, /Grice's maxims/);
      const unknown = await t.rpc('initialize', { protocolVersion: '1999-01-01' });
      assert.equal(unknown.result.protocolVersion, '2025-06-18');
    } finally {
      t.cleanup();
    }
  });

  it('lists the live tools and the full in-app reading tool set with JSON schemas', async () => {
    const t = setup();
    try {
      const { result } = await t.rpc('tools/list');
      const names = result.tools.map((x) => x.name).sort();
      assert.deepEqual(names, [
        'add_bookmark',
        'delete_annotation',
        'get_reading_state',
        'get_selection',
        'glob',
        'grep',
        'highlight',
        'list_annotations',
        'open_in_reader',
        'read_file',
        'read_section_text',
        'remember',
        'resolve_section',
        'search_book',
        'search_library',
        'turn_page',
        'update_annotation',
        'write_file',
      ]);
      const readFile = result.tools.find((x) => x.name === 'read_file');
      assert.equal(readFile.inputSchema.type, 'object');
      assert.deepEqual(readFile.inputSchema.required, ['path']);
      assert.equal(readFile.inputSchema.$schema, undefined);
      assert.equal(readFile.annotations.readOnlyHint, true);
      assert.equal(result.tools.find((x) => x.name === 'remember').annotations.readOnlyHint, false);
    } finally {
      t.cleanup();
    }
  });

  it('reports no open book instead of guessing one', async () => {
    const t = setup();
    try {
      const state = await t.call('get_reading_state');
      assert.match(state.content[0].text, /no_book_open/);
      const read = await t.call('read_file', { path: '/workspace/.wellread/extract/bk1/toc.md' });
      assert.equal(read.isError, true);
      assert.match(read.content[0].text, /No book is open/);
    } finally {
      t.cleanup();
    }
  });

  it('get_reading_state returns the reading context the in-app agent gets', async () => {
    const t = setup({
      ...reading,
      selection: { text: 'goes to sea', cfi: 'epubcfi(/6/2!/4/2/1:8,/1:19)', chapterTitle: 'S0' },
    });
    try {
      const text = (await t.call('get_reading_state')).content[0].text;
      assert.match(text, /<reading_context>/);
      assert.match(text, /Moby-Dick/);
      assert.match(text, /Ishmael goes to sea\./); // focus text inlined
      assert.match(text, /goes to sea/);
      assert.match(text, /00001-a\.md/);
    } finally {
      t.cleanup();
    }
  });

  it('get_selection returns the live selection and queued quotes with their chunks', async () => {
    const t = setup({
      ...reading,
      selection: { text: 'goes to sea', cfi: 'epubcfi(/6/2!/4/2/1:8)', chapterTitle: 'S0' },
      pendingQuotes: [{ text: 'He meets Queequeg.', cfi: 'epubcfi(/6/2!/4/4/1:2)' }],
    });
    try {
      const out = JSON.parse((await t.call('get_selection')).content[0].text);
      assert.equal(out.selection.text, 'goes to sea');
      assert.equal(out.selection.chapterTitle, 'S0');
      assert.ok(out.selection.chunks.some((p) => p.endsWith('00001-a.md')));
      assert.equal(out.pendingQuotes.length, 1);
      assert.ok(out.pendingQuotes[0].chunks.some((p) => p.endsWith('00002-b.md')));

      t.live.set(normalizeReaderLive(reading));
      const none = JSON.parse((await t.call('get_selection')).content[0].text);
      assert.equal(none.selection, null);
      assert.match(none.message, /Nothing is selected/);
    } finally {
      t.cleanup();
    }
  });

  it('runs reading tools on the open book and honors the spoiler guard setting', async () => {
    const t = setup(reading);
    try {
      const later = '/workspace/.wellread/extract/bk1/chunks/00004-d.md';
      const open = JSON.parse((await t.call('read_file', { path: later })).content[0].text);
      assert.equal(open.ok, true);
      assert.match(open.content, /Only Ishmael survives/);

      t.live.set(normalizeReaderLive({ ...reading, spoilerGuard: true }));
      const guarded = JSON.parse((await t.call('read_file', { path: later })).content[0].text);
      assert.equal(guarded.ok, false);
      assert.equal(guarded.error, 'spoiler_guard');
    } finally {
      t.cleanup();
    }
  });

  it('writes through remember like the in-app agent', async () => {
    const t = setup(reading);
    try {
      const out = JSON.parse(
        (await t.call('remember', { scope: 'book', add: ['Finds the cetology chapters slow'] }))
          .content[0].text,
      );
      assert.equal(out.ok, true);
      const state = (await t.call('get_reading_state')).content[0].text;
      assert.match(state, /<reader_memory>[\s\S]*cetology/);
    } finally {
      t.cleanup();
    }
  });

  it('rejects invalid tool arguments and unknown tools', async () => {
    const t = setup(reading);
    try {
      const bad = await t.call('read_file', { path: 42 });
      assert.equal(bad.isError, true);
      assert.match(bad.content[0].text, /invalid_args/);
      const unknown = await t.call('rm_rf');
      assert.equal(unknown.isError, true);
    } finally {
      t.cleanup();
    }
  });

  it('routes reader actions to the open book and returns the reader result', async () => {
    const calls = [];
    const t = setup(reading, async (bookId, type, args) => {
      calls.push({ bookId, type, args });
      return type === 'delete_annotation'
        ? { ok: false, error: 'not_found', message: 'no annotation with that id' }
        : { ok: true, id: 'n1', cfi: 'epubcfi(/6/2!/4/2,/1:0,/1:7)' };
    });
    try {
      const listed = (await t.rpc('tools/list')).result.tools;
      const del = listed.find((x) => x.name === 'delete_annotation');
      assert.equal(del.annotations.destructiveHint, true);
      const hl = listed.find((x) => x.name === 'highlight');
      assert.deepEqual(hl.inputSchema.required, ['text']);

      const made = await t.call('highlight', { text: 'Ishmael', note: 'narrator', color: 'blue' });
      assert.equal(made.isError, undefined);
      assert.equal(JSON.parse(made.content[0].text).id, 'n1');
      assert.deepEqual(calls[0], {
        bookId: 'bk1',
        type: 'highlight',
        args: { text: 'Ishmael', note: 'narrator', color: 'blue' },
      });

      // Reader soft fails come back like any tool's envelope (not a protocol error).
      const missing = await t.call('delete_annotation', { id: 'nope' });
      assert.equal(JSON.parse(missing.content[0].text).error, 'not_found');

      const bad = await t.call('highlight', { text: 'x', color: 'pink' });
      assert.equal(bad.isError, true);
      const empty = await t.call('open_in_reader', {});
      assert.match(empty.content[0].text, /text, cfi or sectionIndex/);
      assert.equal(calls.length, 2);
    } finally {
      t.cleanup();
    }
  });

  it('refuses reader actions with no book open', async () => {
    const t = setup(undefined, async () => ({ ok: true }));
    try {
      const res = await t.call('turn_page', { direction: 'next' });
      assert.equal(res.isError, true);
      assert.match(res.content[0].text, /no_book_open/);
    } finally {
      t.cleanup();
    }
  });

  it('exposes skills as prompts that expand like /skill:<id>', async () => {
    const t = setup(reading);
    try {
      const { result } = await t.rpc('prompts/list');
      const explain = result.prompts.find((p) => p.name === 'explain');
      assert.ok(explain, 'bundled explain skill listed');
      const got = await t.rpc('prompts/get', { name: 'explain', arguments: { request: 'this page' } });
      const text = got.result.messages[0].content.text;
      assert.match(text, /get_reading_state/);
      assert.match(text, /<skill name="explain"/);
      assert.match(text, /this page$/);
      const missing = await t.rpc('prompts/get', { name: 'nope' });
      assert.equal(missing.error.code, -32602);
    } finally {
      t.cleanup();
    }
  });

  it('ignores notifications, rejects unknown methods, handles batches', async () => {
    const t = setup();
    try {
      assert.equal(
        await t.server.handleBody({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        null,
      );
      const res = await t.rpc('resources/list');
      assert.equal(res.error.code, -32601);
      const batch = await t.server.handleBody([
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
      ]);
      assert.deepEqual(batch, [{ jsonrpc: '2.0', id: 1, result: {} }]);
    } finally {
      t.cleanup();
    }
  });
});

describe('reader live store', () => {
  it('normalizes pushes and clears only the live book', () => {
    assert.equal(normalizeReaderLive({ bookId: '../etc' }), null);
    const state = normalizeReaderLive({
      bookId: 'bk1',
      selection: { text: '   ' },
      pendingQuotes: [{ text: ' q ' }, null, { nope: 1 }],
    });
    assert.equal(state.selection, null);
    assert.deepEqual(state.pendingQuotes, [{ text: 'q' }]);
    assert.equal(state.shareAnnotations, true);
    assert.equal(state.spoilerGuard, false);

    const live = createReaderLiveStore();
    live.set(state);
    live.clear('other');
    assert.equal(live.get()?.bookId, 'bk1');
    live.clear('bk1');
    assert.equal(live.get(), null);
  });
});
