import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import {
  cfiKey,
  createCitationVerifier,
  extractCfiKeys,
  filterCitationText,
  filterUnverifiedCitationsStream,
  parseCitationAt,
  stripCfis,
} from './citationGuard.mjs';
import { emptySession, run } from './runTurn.testHarness.mjs';

const SEEN = 'epubcfi(/6/4!/4/2[ch1]/1:0)';
const FAKE = 'epubcfi(/6/99!/4/2/1:0)';

describe('cfi parsing', () => {
  it('extracts balanced cfi bodies, including nested parens and escapes', () => {
    const text = `a ${SEEN} b "epubcfi(/6/2!/4(x)/1:0)" c epubcfi(/6/8!/1:^)0)`;
    assert.deepEqual(extractCfiKeys(text), ['/6/4!/4/2[ch1]/1:0', '/6/2!/4(x)/1:0', '/6/8!/1:^)0']);
    assert.equal(cfiKey(` ${SEEN} `), '/6/4!/4/2[ch1]/1:0');
  });

  it('parses angle and plain citation links, asks for more on partial input', () => {
    const angle = `[第一章](<${SEEN}>)`;
    assert.deepEqual(parseCitationAt(angle, 0), { status: 'link', end: angle.length, cfi: SEEN });
    const plain = `[Ch](${SEEN})`;
    assert.deepEqual(parseCitationAt(plain, 0), { status: 'link', end: plain.length, cfi: SEEN });
    assert.equal(parseCitationAt('[第一章](<epub', 0).status, 'more');
    assert.equal(parseCitationAt('[第一章', 0).status, 'more');
    assert.equal(parseCitationAt('[x](https://a.b)', 0).status, 'no');
    assert.equal(parseCitationAt('[x] plain', 0).status, 'no');
  });

  it('strips cfi spans and link shells from other-book text', () => {
    assert.equal(stripCfis(`见[第一章](<${SEEN}>)。`), '见[第一章]。');
    assert.equal(stripCfis(`### Note\ncfi: ${SEEN}\n> hi`), '### Note\n\n> hi');
  });
});

describe('filterCitationText', () => {
  const isKnown = (cfi) => cfiKey(cfi) === cfiKey(SEEN);

  it('keeps seen citations and drops unseen ones with their leading space', () => {
    const r = filterCitationText(`A。[一](<${SEEN}>) B。 [二](<${FAKE}>) C`, isKnown, true);
    assert.equal(r.out, `A。[一](<${SEEN}>) B。 C`);
    assert.equal(r.dropped, 1);
  });

  it('holds an incomplete link until the next delta', () => {
    const first = filterCitationText('前文[二](<epubcfi(/6/99!', isKnown, false);
    assert.equal(first.out, '前文');
    const second = filterCitationText(`${first.rest}/4/2/1:0)>)后文`, isKnown, false);
    assert.equal(second.out, '后文');
    assert.equal(second.dropped, 1);
  });

  it('flushes a dangling bracket at the end of the part', () => {
    const r = filterCitationText('数组 [1', isKnown, true);
    assert.equal(r.out, '数组 [1');
  });
});

describe('createCitationVerifier', () => {
  it('trusts user context, tool results and sources, never assistant prose', () => {
    const v = createCitationVerifier({
      bookId: 'bk1',
      messages: [
        { role: 'user', content: 'q', modelContent: `<reading_context>\ncfi: "${SEEN}"\n</reading_context>` },
        {
          role: 'assistant',
          content: `invented [x](<${FAKE}>)`,
          tools: [{ name: 'search_book', args: {}, result: { hits: [{ cfi: 'epubcfi(/6/10!/2)' }] } }],
          sources: [{ cfi: 'epubcfi(/6/12!/2)' }],
        },
      ],
    });
    assert.equal(v.isKnown(SEEN), true);
    assert.equal(v.isKnown('epubcfi(/6/10!/2)'), true);
    assert.equal(v.isKnown('epubcfi(/6/12!/2)'), true);
    assert.equal(v.isKnown(FAKE), false);
  });

  it('ignores cfi values that belong to other books', () => {
    const v = createCitationVerifier({ bookId: 'bk1', messages: [] });
    v.addToolResult('search_library', { query: 'x' }, { hits: [{ snippet: 'epubcfi(/6/20!/2)' }] });
    v.addToolResult(
      'read_file',
      { path: '/workspace/.wellread/annotations/bk2.md' },
      { content: 'cfi: epubcfi(/6/22!/2)' },
    );
    v.addToolResult(
      'read_file',
      { path: '/workspace/.wellread/annotations/bk1.md' },
      { content: 'cfi: epubcfi(/6/24!/2)' },
    );
    assert.equal(v.isKnown('epubcfi(/6/20!/2)'), false);
    assert.equal(v.isKnown('epubcfi(/6/22!/2)'), false);
    assert.equal(v.isKnown('epubcfi(/6/24!/2)'), true);
  });

  it('accepts exact chunk boundaries from the section index unless spoiler-hidden', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'eve-cite-')));
    try {
      const dir = join(root, '.wellread', 'extract', 'bk1');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'section-index.json'),
        JSON.stringify({
          schemaVersion: 2,
          sections: {
            0: [
              { fileName: '00001-a.md', chunkIndex: 0, sectionIndex: 0, title: 'A', cfi: 'epubcfi(/6/2!/4/1:0)', endCfi: 'epubcfi(/6/2!/4/1:9)' },
              { fileName: '00002-b.md', chunkIndex: 1, sectionIndex: 0, title: 'A', cfi: 'epubcfi(/6/2!/4/1:10)', endCfi: 'epubcfi(/6/2!/4/1:19)' },
            ],
          },
          titles: { a: [0] },
        }),
      );
      const v = createCitationVerifier({
        booksRoot: root,
        bookId: 'bk1',
        spoilerGuard: { isPathHidden: (p) => p.endsWith('00002-b.md') },
      });
      assert.equal(v.isKnown('epubcfi(/6/2!/4/1:0)'), true);
      assert.equal(v.isKnown('epubcfi(/6/2!/4/1:10)'), false);
      assert.equal(v.isKnown('epubcfi(/6/2!/4/1:5)'), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('filterUnverifiedCitationsStream', () => {
  it('learns from streamed tool output before filtering later text', async () => {
    const v = createCitationVerifier({ bookId: 'bk1' });
    const parts = [
      { type: 'tool-input-available', toolCallId: 't1', toolName: 'read_file', input: { path: '/workspace/.wellread/extract/bk1/chunks/00001-a.md' } },
      { type: 'tool-output-available', toolCallId: 't1', output: { ok: true, content: `---\ncfi: "${SEEN}"\n---\nx` } },
      { type: 'text-start', id: 'x' },
      { type: 'text-delta', id: 'x', delta: '甲。[一](<epub' },
      { type: 'text-delta', id: 'x', delta: `cfi(/6/4!/4/2[ch1]/1:0)>) 乙。 [二](<${FAKE.slice(0, 12)}` },
      { type: 'text-delta', id: 'x', delta: `${FAKE.slice(12)}>)` },
      { type: 'text-end', id: 'x' },
    ];
    let dropped = 0;
    const out = [];
    const reader = filterUnverifiedCitationsStream(
      new ReadableStream({
        start(c) {
          for (const p of parts) c.enqueue(p);
          c.close();
        },
      }),
      v,
      { onDropped: (n) => (dropped = n) },
    ).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(value);
    }
    const text = out.filter((c) => c.type === 'text-delta').map((c) => c.delta).join('');
    assert.equal(text, `甲。[一](<${SEEN}>) 乙。`);
    assert.equal(dropped, 1);
    assert.equal(out.at(-1).type, 'text-end');
  });
});

describe('runTurn citation guard', () => {
  it('drops unverified citations from the streamed and persisted reply', async () => {
    let call = 0;
    const model = {
      specificationVersion: 'v2',
      provider: 'test',
      modelId: 'cite-test',
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error('unused');
      },
      doStream: async () => {
        call += 1;
        const events =
          call === 1
            ? [
                { type: 'tool-call', toolCallId: 'tc1', toolName: 'read_file', input: JSON.stringify({ path: '/workspace/.wellread/extract/book_1/chunks/00001-a.md' }) },
                { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
              ]
            : [
                { type: 'text-start', id: 't1' },
                { type: 'text-delta', id: 't1', delta: `他出海了。[第一章](<${SEEN}>)` },
                { type: 'text-delta', id: 't1', delta: ` 后来沉船。 [第九章](<${FAKE}>)` },
                { type: 'text-end', id: 't1' },
                { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
              ];
        return {
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: 'stream-start', warnings: [] });
              for (const e of events) c.enqueue(e);
              c.close();
            },
          }),
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      },
    };
    const tools = {
      read_file: tool({
        description: 'read',
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => ({ ok: true, path, content: `---\ncfi: "${SEEN}"\ntitle: "第一章"\n---\n\n他出海了。` }),
      }),
    };
    const session = emptySession();
    const { chunks, assistant } = await run({
      model: /** @type {any} */ (model),
      session,
      userMessage: '后来呢？',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
    });
    const streamed = chunks.filter((c) => c.type === 'text-delta').map((c) => c.delta).join('');
    assert.equal(streamed, `他出海了。[第一章](<${SEEN}>) 后来沉船。`);
    assert.ok(assistant);
    assert.equal(assistant.content, `他出海了。[第一章](<${SEEN}>) 后来沉船。`);
  });
});
