import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runTurn } from './runTurn.mjs';

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
  it('expands /skill:id into the user message and lists the skill in the system catalog', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-runturn-skill-')));
    try {
      mkdirSync(join(booksRoot, 'skills', 'summarize'), { recursive: true });
      writeFileSync(
        join(booksRoot, 'skills', 'summarize', 'SKILL.md'),
        '---\nname: Summarize\ndescription: Summary\n---\nBe concise about the chapter.\n',
      );
      const sink = {};
      const events = [];
      const session = emptySession();
      await runTurn({
        model: capturePromptModel(sink),
        session,
        userMessage: '/skill:summarize this chapter',
        getBooksRoot: () => booksRoot,
        onEvent: (e) => events.push(e),
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

      // Session / wire event keep the slash short form for UI.
      assert.equal(session.messages[0]?.content, '/skill:summarize this chapter');
      const userEvent = events.find((e) => e.type === 'message.user');
      assert.equal(userEvent?.content, '/skill:summarize this chapter');
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
      await runTurn({
        model: capturePromptModel(sink),
        session,
        userMessage: 'I pick network effects, score 5.',
        getBooksRoot: () => booksRoot,
        onEvent: () => {},
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
      await runTurn({
        model: capturePromptModel(sink),
        session: emptySession(),
        userMessage: '/skill:nope',
        getBooksRoot: () => booksRoot,
        onEvent: () => {},
        tools: {},
        generateTextFn: async () => ({ text: '', usage: {} }),
      });
      const system = systemTextFromPrompt(sink.prompt);
      assert.doesNotMatch(system, /## Active skill/);
      assert.doesNotMatch(system, /Available skills/);
      const userTexts = userTextsFromPrompt(sink.prompt);
      assert.equal(userTexts.at(-1), '/skill:nope');
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });
});
