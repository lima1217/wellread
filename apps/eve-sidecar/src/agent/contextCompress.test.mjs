import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMPRESS_TARGET_RATIO,
  COMPRESS_TRIGGER_RATIO,
  estimateMessagesTokens,
  estimateTokens,
  planCompression,
  applyCompressionPlan,
  buildCompressPrompt,
  formatStructuredSummary,
} from './contextCompress.mjs';

describe('contextCompress estimates', () => {
  it('estimates ASCII tokens as ceil(chars/4)', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcde'), 2);
    assert.equal(estimateTokens(''), 0);
  });

  it('weights CJK characters higher than ASCII (compression trigger safety)', () => {
    assert.equal(estimateTokens('中文'), 3); // 2 * 1.5
    assert.ok(estimateTokens('中'.repeat(40)) > estimateTokens('x'.repeat(40)));
  });

  it('sums message contents with small per-message overhead', () => {
    const tokens = estimateMessagesTokens([
      { role: 'user', content: 'abcd' },
      { role: 'assistant', content: 'abcd' },
    ]);
    assert.equal(tokens, estimateTokens('abcd') + 4 + estimateTokens('abcd') + 4);
  });

  it('counts reasoning, tools, and modelMessages in the estimate', () => {
    const tokens = estimateMessagesTokens([
      {
        role: 'assistant',
        content: 'abcd',
        reasoning: 'abcd',
        tools: [{ id: 't1' }],
        modelMessages: [{ role: 'assistant', content: 'wire' }],
      },
    ]);
    const toolsTokens = estimateTokens(JSON.stringify([{ id: 't1' }]));
    const modelTokens = estimateTokens(
      JSON.stringify([{ role: 'assistant', content: 'wire' }]),
    );
    assert.equal(
      tokens,
      estimateTokens('abcd') + 4 + estimateTokens('abcd') + toolsTokens + modelTokens,
    );
  });
});

describe('planCompression', () => {
  const systemPrompt = 'sys'; // 1 token
  const window = 1000;

  function msg(role, chars, id = `m_${chars}`) {
    return { id, role, content: 'x'.repeat(chars), createdAt: 1 };
  }

  it('returns null below the 68% trigger', () => {
    // system(1) + one short message stays well under 0.68 * 1000
    const plan = planCompression({
      messages: [msg('user', 40)],
      systemPrompt,
      contextWindowTokens: window,
    });
    assert.equal(plan, null);
  });

  it('triggers at or above 68% and targets ~20% after compression', () => {
    assert.equal(COMPRESS_TRIGGER_RATIO, 0.68);
    assert.equal(COMPRESS_TARGET_RATIO, 0.2);

    // Build history that exceeds 68% of 1000 ≈ 680 tokens.
    // Each message: chars/4 + 4 overhead. 20 msgs * (200/4 + 4) = 20*54 = 1080 + system.
    const messages = [];
    for (let i = 0; i < 20; i++) {
      messages.push(msg(i % 2 === 0 ? 'user' : 'assistant', 200, `m_${i}`));
    }

    const plan = planCompression({
      messages,
      systemPrompt,
      contextWindowTokens: window,
    });
    assert.ok(plan);
    assert.ok(plan.beforeTokens >= Math.floor(window * COMPRESS_TRIGGER_RATIO));
    assert.ok(plan.dropIds.length > 0);
    assert.ok(plan.keepIds.length >= 1);
    assert.equal(plan.keepIds[plan.keepIds.length - 1], 'm_19');

    const keepMsgs = messages.filter((m) => plan.keepIds.includes(m.id));
    const dropMsgs = messages.filter((m) => plan.dropIds.includes(m.id));
    assert.equal(keepMsgs.length + dropMsgs.length, messages.length);

    // Room left for summary under the 20% target (system + keep + summaryBudget).
    const target = Math.floor(window * COMPRESS_TARGET_RATIO);
    const afterWithoutSummary =
      estimateTokens(systemPrompt) + estimateMessagesTokens(keepMsgs);
    assert.ok(afterWithoutSummary + plan.summaryBudgetTokens <= target + 8);
    assert.ok(plan.summaryBudgetTokens > 0);
  });

  it('always keeps the newest message and drops older ones when over trigger', () => {
    const messages = [
      msg('user', 2000, 'old'),
      msg('assistant', 2000, 'old_a'),
      msg('user', 4000, 'huge'),
    ];
    const plan = planCompression({
      messages,
      systemPrompt,
      contextWindowTokens: window,
    });
    assert.ok(plan);
    assert.deepEqual(plan.keepIds, ['huge']);
    assert.deepEqual(plan.dropIds, ['old', 'old_a']);
  });

  it('uses full message weight (modelMessages) when deciding what to keep', () => {
    // Content-only looks tiny, but modelMessages make each older turn heavy.
    // Keep-loop must not treat them as cheap content-only rows.
    const fat = {
      id: 'fat_a',
      role: 'assistant',
      content: 'ok',
      createdAt: 1,
      modelMessages: [{ role: 'assistant', content: 'y'.repeat(2000) }],
    };
    const messages = [
      { id: 'u1', role: 'user', content: 'x'.repeat(2000), createdAt: 1 },
      fat,
      { id: 'u2', role: 'user', content: 'x'.repeat(2000), createdAt: 1 },
    ];
    const plan = planCompression({
      messages,
      systemPrompt,
      contextWindowTokens: window,
    });
    assert.ok(plan);
    // Newest user kept; fat assistant should not sneak into keep via content-only estimate.
    assert.ok(plan.keepIds.includes('u2'));
    assert.ok(plan.dropIds.includes('fat_a'));
  });

  it('returns null when only one oversized message (nothing to summarize)', () => {
    const plan = planCompression({
      messages: [msg('user', 4000, 'huge')],
      systemPrompt,
      contextWindowTokens: window,
    });
    assert.equal(plan, null);
  });
});

describe('applyCompressionPlan', () => {
  it('replaces dropped prefix with a summary assistant message', () => {
    const messages = [
      { id: 'a', role: 'user', content: 'old q', createdAt: 1 },
      { id: 'b', role: 'assistant', content: 'old a', createdAt: 2 },
      { id: 'c', role: 'user', content: 'new q', createdAt: 3 },
    ];
    const next = applyCompressionPlan({
      messages,
      keepIds: ['c'],
      summary: 'Prior chat: user asked about X.',
      summaryId: 'sum_1',
      now: 99,
    });
    assert.equal(next.length, 2);
    assert.equal(next[0].id, 'sum_1');
    assert.equal(next[0].role, 'assistant');
    assert.match(next[0].content, /Prior chat/);
    assert.equal(next[0].compacted, true);
    assert.equal(next[1].id, 'c');
  });
});

describe('formatStructuredSummary / buildCompressPrompt', () => {
  it('asks for labeled fields and drops resolved tool errors', () => {
    const prompt = buildCompressPrompt({
      bookTitle: 'Moby Dick',
      summaryBudgetTokens: 100,
    });
    assert.match(prompt, /goals:/);
    assert.match(prompt, /conclusions:/);
    assert.match(prompt, /open_questions:/);
    assert.match(prompt, /cfi_refs:/);
    assert.match(prompt, /tool errors that were later resolved/i);
  });

  it('normalizes labeled summarizer output', () => {
    const out = formatStructuredSummary(
      'goals: understand Ahab\nconclusions: He hunts the whale\nopen_questions: Why?\ncfi_refs: epubcfi(/6/2!)',
    );
    assert.equal(
      out,
      [
        'goals: understand Ahab',
        'conclusions: He hunts the whale',
        'open_questions: Why?',
        'cfi_refs: epubcfi(/6/2!)',
      ].join('\n'),
    );
  });

  it('wraps free prose as conclusions', () => {
    assert.equal(
      formatStructuredSummary('User asked about Ahab.'),
      'conclusions: User asked about Ahab.',
    );
  });

  it('omits empty labeled lines', () => {
    assert.equal(
      formatStructuredSummary('goals: find theme\nconclusions:\nopen_questions:'),
      'goals: find theme',
    );
  });
});

describe('maybeCompressSession', () => {
  it('rewrites the session and emits context.compressed when over trigger', async () => {
    const { maybeCompressSession } = await import('./contextCompress.mjs');
    const messages = [];
    for (let i = 0; i < 20; i++) {
      messages.push({
        id: `m_${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'x'.repeat(200),
        createdAt: i,
      });
    }
    const session = {
      id: 'ses',
      bookId: 'b1',
      bookTitle: 'Demo',
      title: 'Chat',
      createdAt: 1,
      updatedAt: 1,
      messages,
    };
    const events = [];
    const ok = await maybeCompressSession({
      model: /** @type {any} */ ({}),
      session,
      systemPrompt: 'sys',
      contextWindowTokens: 1000,
      onEvent: (e) => events.push(e),
      generateTextFn: async () => ({ text: 'Compacted prior turns about the book.' }),
    });
    assert.equal(ok, true);
    assert.equal(session.messages[0].compacted, true);
    assert.match(session.messages[0].content, /Compacted prior/);
    assert.ok(session.messages.some((m) => m.id === 'm_19'));
    assert.equal(events[0]?.type, 'context.compressed');
    assert.ok(events[0].removedIds.length > 0);
  });

  it('leaves session intact and emits compress_failed when summarizer throws', async () => {
    const { maybeCompressSession } = await import('./contextCompress.mjs');
    const messages = [];
    for (let i = 0; i < 20; i++) {
      messages.push({
        id: `m_${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'x'.repeat(200),
        createdAt: i,
      });
    }
    const session = {
      id: 'ses',
      bookId: 'b1',
      title: 'Chat',
      createdAt: 1,
      updatedAt: 1,
      messages: [...messages],
    };
    const before = session.messages.length;
    const events = [];
    const ok = await maybeCompressSession({
      model: /** @type {any} */ ({}),
      session,
      systemPrompt: 'sys',
      contextWindowTokens: 1000,
      onEvent: (e) => events.push(e),
      generateTextFn: async () => {
        throw new Error('summarizer down');
      },
    });
    assert.equal(ok, false);
    assert.equal(session.messages.length, before);
    assert.equal(events[0]?.type, 'context.compress_failed');
  });
});
