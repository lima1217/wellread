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

function captureSystemModel(sink) {
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

describe('runTurn skill mount', () => {
  it('injects Active skill into the system prompt for /id messages', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-runturn-skill-')));
    try {
      mkdirSync(join(booksRoot, 'skills', 'summarize'), { recursive: true });
      writeFileSync(
        join(booksRoot, 'skills', 'summarize', 'SKILL.md'),
        '---\nname: Summarize\ndescription: Summary\n---\nBe concise about the chapter.\n',
      );
      const sink = {};
      const events = [];
      await runTurn({
        model: captureSystemModel(sink),
        session: emptySession(),
        userMessage: '/summarize this chapter',
        getBooksRoot: () => booksRoot,
        onEvent: (e) => events.push(e),
        tools: {},
        generateTextFn: async () => ({ text: '', usage: {} }),
      });
      const system = systemTextFromPrompt(sink.prompt);
      assert.match(system, /## Active skill \/summarize \(Summarize\)/);
      assert.match(system, /Be concise about the chapter/);
      assert.equal(events.some((e) => e.type === 'message.user'), true);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('does not mount when the slash id is unknown', async () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-runturn-skill-')));
    try {
      mkdirSync(join(booksRoot, 'skills'), { recursive: true });
      const sink = {};
      await runTurn({
        model: captureSystemModel(sink),
        session: emptySession(),
        userMessage: '/nope',
        getBooksRoot: () => booksRoot,
        onEvent: () => {},
        tools: {},
        generateTextFn: async () => ({ text: '', usage: {} }),
      });
      const system = systemTextFromPrompt(sink.prompt);
      assert.doesNotMatch(system, /## Active skill/);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });
});
