import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NOTE_COMPOSE_MAX_ATTEMPTS,
  composeOkfNotePage,
  okfComposedPageSchema,
  renderOkfNoteMarkdown,
} from './noteCompose.mjs';

describe('renderOkfNoteMarkdown', () => {
  it('renders PACKAGE-shaped frontmatter and body', () => {
    const md = renderOkfNoteMarkdown(
      {
        type: 'Concept',
        title: '网络效应',
        description: '一句话',
        origin: 'chapter',
        tags: ['核心'],
        status: 'active',
        body: '耐久定义。\n\n[小节](epubcfi(/6/2!))',
      },
      { timestamp: '2026-08-02T00:00:00.000Z' },
    );
    assert.match(md, /^---\n/);
    assert.match(md, /type: Concept\n/);
    assert.match(md, /title: "网络效应"\n/);
    assert.match(md, /description: "一句话"\n/);
    assert.match(md, /origin: chapter\n/);
    assert.match(md, /tags: \["核心"\]\n/);
    assert.match(md, /status: active\n/);
    assert.match(md, /timestamp: 2026-08-02T00:00:00.000Z\n/);
    assert.match(md, /---\n\n耐久定义/);
  });
});

describe('composeOkfNotePage', () => {
  it('expands a draft via structured output and locks identity fields', async () => {
    /** @type {unknown[]} */
    const calls = [];
    const result = await composeOkfNotePage({
      model: /** @type {any} */ ({ provider: 'test' }),
      path: '/workspace/.wellread/notes/bk1/concepts/网络效应.md',
      draft: {
        type: 'Concept',
        title: '网络效应',
        description: 'hint',
        origin: 'chapter',
        material: 'Metcalfe; chapter 3',
      },
      now: () => new Date('2026-08-02T00:00:00.000Z'),
      generateTextFn: async (opts) => {
        calls.push(opts);
        return {
          output: {
            type: 'Framework', // should be locked back to Concept
            title: 'Wrong',
            description: 'from model',
            origin: 'chat',
            body: 'Body from model with [cfi](epubcfi(/6/4!)).',
          },
        };
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.attempts, 1);
    assert.equal(result.page.type, 'Concept');
    assert.equal(result.page.title, '网络效应');
    assert.equal(result.page.description, 'hint');
    assert.equal(result.page.origin, 'chapter');
    assert.match(result.markdown, /type: Concept/);
    assert.match(result.markdown, /Body from model/);
    assert.equal(calls.length, 1);
    assert.ok(calls[0]?.output);
  });

  it('retries once when the first structured output fails', async () => {
    let n = 0;
    const result = await composeOkfNotePage({
      model: /** @type {any} */ ({}),
      path: '/workspace/.wellread/notes/bk1/claims/x.md',
      draft: {
        type: 'Claim',
        title: 'X',
        material: 'evidence',
      },
      generateTextFn: async () => {
        n += 1;
        if (n === 1) throw new Error('bad json');
        return {
          output: okfComposedPageSchema.parse({
            type: 'Claim',
            title: 'X',
            description: '',
            body: 'Fixed body.',
          }),
        };
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.attempts, 2);
    assert.equal(n, 2);
  });

  it('returns compose_failed after exhausting retries', async () => {
    const result = await composeOkfNotePage({
      model: /** @type {any} */ ({}),
      path: '/workspace/.wellread/notes/bk1/concepts/a.md',
      draft: {
        type: 'Concept',
        title: 'A',
        material: 'x',
      },
      maxAttempts: NOTE_COMPOSE_MAX_ATTEMPTS,
      generateTextFn: async () => {
        throw new Error('still broken');
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, 'compose_failed');
    assert.equal(result.attempts, NOTE_COMPOSE_MAX_ATTEMPTS);
    assert.match(result.message, /still broken/);
  });

  it('does not retry after AbortError from generateText', async () => {
    let n = 0;
    const result = await composeOkfNotePage({
      model: /** @type {any} */ ({}),
      path: '/workspace/.wellread/notes/bk1/concepts/a.md',
      draft: {
        type: 'Concept',
        title: 'A',
        material: 'x',
      },
      generateTextFn: async () => {
        n += 1;
        const err = new Error('This operation was aborted');
        err.name = 'AbortError';
        throw err;
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, 'aborted');
    assert.equal(result.attempts, 1);
    assert.equal(n, 1);
  });
});
