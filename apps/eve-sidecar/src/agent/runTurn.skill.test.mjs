import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { runTurn, consumeUIMessageStream } from './runTurn.mjs';
import { invalidateSkillsCache } from './skills/discover.mjs';
import { setBundledSkillsRootForTests } from './skills/bundledRoot.mjs';

afterEach(() => {
  setBundledSkillsRootForTests(undefined);
  invalidateSkillsCache();
});

function emptySession() {
  return {
    id: 'sess_skill',
    bookId: 'book_1',
    bookTitle: 'Test Book',
    title: 'Chat about Test Book',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

/**
 * @param {Parameters<typeof runTurn>[0]} input
 */
async function run(input) {
  await consumeUIMessageStream(runTurn(input));
}

function capturePromptModel(sink) {
  return {
    specificationVersion: 'v2',
    provider: 'test',
    modelId: 'sys-capture',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('doGenerate unused');
    },
    doStream: async ({ prompt }) => {
      sink.prompt = prompt;
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't1' });
            controller.enqueue({ type: 'text-delta', id: 't1', delta: 'ok' });
            controller.enqueue({ type: 'text-end', id: 't1' });
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            });
            controller.close();
          },
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    },
  };
}

function systemTextFromPrompt(prompt) {
  if (typeof prompt === 'string') return prompt;
  if (Array.isArray(prompt)) {
    return prompt
      .filter((p) => p && (p.role === 'system' || p.type === 'system'))
      .map((p) => (typeof p.content === 'string' ? p.content : JSON.stringify(p.content)))
      .join('\n');
  }
  if (prompt && typeof prompt === 'object' && typeof prompt.system === 'string') {
    return prompt.system;
  }
  return JSON.stringify(prompt);
}

/** Collect user-role text parts from an AI SDK prompt capture. */
function userTextsFromPrompt(prompt) {
  const texts = [];
  if (!Array.isArray(prompt)) return texts;
  for (const part of prompt) {
    if (!part || part.role !== 'user') continue;
    if (typeof part.content === 'string') {
      texts.push(part.content);
      continue;
    }
    if (Array.isArray(part.content)) {
      for (const block of part.content) {
        if (block && block.type === 'text' && typeof block.text === 'string') {
          texts.push(block.text);
        }
      }
    }
  }
  return texts;
}

describe('runTurn skill expansion', () => {
  it('puts Pending Quotes into reading_context and expands /skill: without quote blocks', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-runturn-skill-')));
    try {
      mkdirSync(join(booksRoot, 'skills', 'summarize'), { recursive: true });
      writeFileSync(
        join(booksRoot, 'skills', 'summarize', 'SKILL.md'),
        '---\nname: Summarize\ndescription: Summary\n---\nBe concise about the chapter.\n',
      );
      const sink = {};
      const session = emptySession();
      const wire =
        '> Call me Ishmael.\n> — 《Loomings》\n\n/skill:summarize this chapter';
      await run({
        model: capturePromptModel(sink),
        session,
        userMessage: wire,
        getBooksRoot: () => booksRoot,
        tools: {},
        readerState: { chapter: 'Loomings', cfi: 'epubcfi(/6/2!)' },
        generateTextFn: async () => ({ text: '', usage: {} }),
      });
      const system = systemTextFromPrompt(sink.prompt);
      assert.match(system, /<reading_context>/);
      assert.match(system, /Call me Ishmael/);
      assert.match(system, /position: \(client-reported, may be stale\)/);
      assert.match(system, /epubcfi\(\/6\/2!\)/);

      const userTexts = userTextsFromPrompt(sink.prompt);
      const modelUser = userTexts[userTexts.length - 1] || '';
      assert.match(modelUser, /^<skill name="summarize"/);
      assert.doesNotMatch(modelUser, /^>/);
      assert.doesNotMatch(modelUser, /Call me Ishmael/);
      assert.equal(session.messages[0]?.content, wire);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('keeps quote-only turns quote-free in model user text (envelope only)', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-runturn-quote-')));
    try {
      const sink = {};
      const session = emptySession();
      const wire = '> Call me Ishmael.\n> — 《Loomings》';
      await run({
        model: capturePromptModel(sink),
        session,
        userMessage: wire,
        getBooksRoot: () => booksRoot,
        tools: {},
        generateTextFn: async () => ({ text: 'ok', usage: {} }),
      });
      const system = systemTextFromPrompt(sink.prompt);
      assert.match(system, /Call me Ishmael/);
      const userTexts = userTextsFromPrompt(sink.prompt);
      const modelUser = userTexts[userTexts.length - 1] || '';
      assert.equal(modelUser, '');
      assert.doesNotMatch(modelUser, /Call me Ishmael/);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('expands /skill:id into the user message and lists the skill in the system catalog', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-runturn-skill-')));
    try {
      mkdirSync(join(booksRoot, 'skills', 'summarize'), { recursive: true });
      writeFileSync(
        join(booksRoot, 'skills', 'summarize', 'SKILL.md'),
        '---\nname: Summarize\ndescription: Summary\n---\nBe concise about the chapter.\n',
      );
      const sink = {};
      const session = emptySession();
      await run({
        model: capturePromptModel(sink),
        session,
        userMessage: '/skill:summarize this chapter',
        getBooksRoot: () => booksRoot,
        tools: {},
        generateTextFn: async () => ({ text: '', usage: {} }),
      });
      const system = systemTextFromPrompt(sink.prompt);
      assert.doesNotMatch(system, /## Active skill/);
      assert.doesNotMatch(system, /Be concise about the chapter/);
      assert.match(system, /Available skills/);
      assert.match(system, /- summarize: Summary \(\/workspace\/skills\/summarize\/SKILL\.md\)/);

      const userTexts = userTextsFromPrompt(sink.prompt);
      assert.equal(userTexts.length >= 1, true);
      const modelUser = userTexts[userTexts.length - 1] || '';
      assert.match(modelUser, /^<skill name="summarize"/);
      assert.match(modelUser, /Be concise about the chapter/);
      assert.match(modelUser, /\n\nthis chapter$/);

      assert.equal(session.messages[0]?.content, '/skill:summarize this chapter');
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('keeps the skills catalog on a later turn without re-expanding the slash body', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-runturn-skill-')));
    try {
      mkdirSync(join(booksRoot, 'skills', 'grill-me'), { recursive: true });
      writeFileSync(
        join(booksRoot, 'skills', 'grill-me', 'SKILL.md'),
        '---\nname: grill-me\ndescription: Probe causal understanding\n---\nAsk one question at a time.\n',
      );
      const session = emptySession();
      session.messages.push({
        id: 'msg_prev_u',
        role: 'user',
        content: '/skill:grill-me start',
        createdAt: Date.now(),
      });
      session.messages.push({
        id: 'msg_prev_a',
        role: 'assistant',
        content: 'Pick a target and score yourself 1-7.',
        createdAt: Date.now(),
      });
      const sink = {};
      await run({
        model: capturePromptModel(sink),
        session,
        userMessage: 'I pick network effects, score 5.',
        getBooksRoot: () => booksRoot,
        tools: {},
        generateTextFn: async () => ({ text: '', usage: {} }),
      });
      const system = systemTextFromPrompt(sink.prompt);
      assert.match(system, /Available skills/);
      assert.match(system, /- grill-me: Probe causal understanding \(\/workspace\/skills\/grill-me\/SKILL\.md\)/);
      assert.doesNotMatch(system, /Ask one question at a time/);

      const userTexts = userTextsFromPrompt(sink.prompt);
      assert.equal(userTexts.at(-1), 'I pick network effects, score 5.');
      assert.equal(
        userTexts.some((t) => t.includes('Ask one question at a time')),
        false,
      );
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('does not expand when the slash id is unknown', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-runturn-skill-')));
    try {
      mkdirSync(join(booksRoot, 'skills'), { recursive: true });
      const sink = {};
      await run({
        model: capturePromptModel(sink),
        session: emptySession(),
        userMessage: '/skill:nope',
        getBooksRoot: () => booksRoot,
        tools: {},
        generateTextFn: async () => ({ text: '', usage: {} }),
      });
      const system = systemTextFromPrompt(sink.prompt);
      assert.doesNotMatch(system, /## Active skill/);
      assert.doesNotMatch(system, /- nope:/);
      const userTexts = userTextsFromPrompt(sink.prompt);
      assert.equal(userTexts.at(-1), '/skill:nope');
      assert.equal(
        userTexts.some((t) => t.includes('<skill name="nope"')),
        false,
      );
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });
});
