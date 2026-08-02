import {
  enrichUIMessageStreamWithSources,
  consumeUIMessageStream,
} from './runTurn.mjs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tool } from 'ai';
import { z } from 'zod';
import {
  emptySession,
  run,
  narrateThenToolThenAnswerModel,
} from './runTurn.testHarness.mjs';

describe('runTurn parts persistence + live sources', () => {
  it('persists ordered parts (text can interleave with tools)', async () => {
    const session = emptySession();
    const tools = {
      grep: tool({
        description: 'grep',
        inputSchema: z.object({ q: z.string() }),
        execute: async ({ q }) => ({ hits: [q] }),
      }),
    };

    const { assistant } = await run({
      model: /** @type {any} */ (narrateThenToolThenAnswerModel()),
      session,
      userMessage: 'Who is Ahab?',
      getBooksRoot: () => '/tmp/books-should-not-matter',
      tools,
      maxToolRounds: 2,
    });

    assert.ok(assistant);
    assert.ok(Array.isArray(assistant.parts));
    assert.ok(assistant.parts.length >= 2);
    const types = assistant.parts.map((p) => p.type);
    assert.ok(types.includes('text'));
    assert.ok(types.includes('dynamic-tool') || types.some((t) => String(t).startsWith('tool-')));
  });

  it('emits message-metadata.sources as tool outputs arrive', async () => {
    const chunkMd = `---
cfi: "epubcfi(/6/2!)"
title: "Loomings"
---
Call me Ishmael.
`;
    const base = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'tool-input-available',
          toolCallId: 'tc1',
          toolName: 'read_file',
          input: { path: '/workspace/x.md' },
        });
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'tc1',
          output: { ok: true, path: '/workspace/x.md', content: chunkMd },
        });
        controller.enqueue({ type: 'finish', finishReason: 'stop' });
        controller.close();
      },
    });

    const chunks = await consumeUIMessageStream(enrichUIMessageStreamWithSources(base));
    const meta = chunks.find((c) => c.type === 'message-metadata');
    assert.ok(meta, 'expected message-metadata chunk');
    assert.equal(meta.messageMetadata?.sources?.[0]?.cfi, 'epubcfi(/6/2!)');
  });
});

