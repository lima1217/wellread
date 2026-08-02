/**
 * Offline Reading Assistant contract gates (no live model).
 * Run via: npm test (picked up by src/** + eval via package.json).
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  appendReadingContext,
  buildReadingContextEnvelope,
  buildSystemPrompt,
} from '../src/agent/prompt.mjs';
import { readExtractStatus } from '../src/agent/extractMeta.mjs';
import {
  resolveFocusChunks,
  resolveSectionChunksByIndex,
} from '../src/agent/resolveSectionChunks.mjs';
import { expandSkillCommand } from '../src/agent/skills/invoke.mjs';
import { createReadingTools } from '../src/agent/tools.mjs';

function seedExtract(root, bookId) {
  const dir = join(root, '.wellread', 'extract', bookId);
  const chunks = join(dir, 'chunks');
  mkdirSync(chunks, { recursive: true });
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      bookId,
      sourceHash: 'h',
      sourceMtimeMs: 1,
      format: 'EPUB',
      extractedAt: 1,
      chunkCount: 2,
      schemaVersion: 2,
      status: 'ready',
    }),
  );
  writeFileSync(
    join(dir, 'section-index.json'),
    JSON.stringify({
      schemaVersion: 2,
      sections: {
        '0': [
          {
            fileName: '00001-a.md',
            chunkIndex: 0,
            sectionIndex: 0,
            title: 'Loomings',
            cfi: 'epubcfi(/6/2!/4/2/1:0)',
            endCfi: 'epubcfi(/6/2!/4/2/1:20)',
          },
          {
            fileName: '00002-b.md',
            chunkIndex: 1,
            sectionIndex: 0,
            title: 'Loomings',
            cfi: 'epubcfi(/6/2!/4/2/1:21)',
            endCfi: 'epubcfi(/6/2!/4/2/1:40)',
          },
        ],
      },
      titles: { loomings: [0] },
    }),
  );
  writeFileSync(
    join(chunks, '00001-a.md'),
    `---
sectionIndex: 0
chunkIndex: 0
title: "Loomings"
cfi: "epubcfi(/6/2!/4/2/1:0)"
endCfi: "epubcfi(/6/2!/4/2/1:20)"
---

Call me Ishmael.
`,
  );
  writeFileSync(
    join(chunks, '00002-b.md'),
    `---
sectionIndex: 0
chunkIndex: 1
title: "Loomings"
cfi: "epubcfi(/6/2!/4/2/1:21)"
endCfi: "epubcfi(/6/2!/4/2/1:40)"
---

Some years ago.
`,
  );
}

describe('eval: reading contract', () => {
  it('system prompt encodes focus vs section policy', () => {
    const prompt = buildSystemPrompt({ bookId: 'bk1', bookTitle: 'Moby' });
    assert.match(prompt, /focus_chunks/i);
    assert.match(prompt, /section_chunks/i);
    assert.match(prompt, /extract_status/i);
    assert.match(prompt, /never glob extract/i);
  });

  it('envelope + index resolve + focus for a position turn', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-eval-'));
    seedExtract(root, 'bk1');
    const status = readExtractStatus(root, 'bk1');
    assert.equal(status.status, 'ready');
    const section = resolveSectionChunksByIndex(root, 'bk1', 0);
    assert.equal(section.fromIndex, true);
    assert.equal(section.count, 2);
    const focus = resolveFocusChunks({
      booksRoot: root,
      bookId: 'bk1',
      readerState: { sectionIndex: 0, cfi: 'epubcfi(/6/2!/4/2/1:25)' },
    });
    assert.equal(focus?.via, 'cfi');
    assert.match(focus?.paths[0] ?? '', /00002-b/);
    const env = buildReadingContextEnvelope({
      bookId: 'bk1',
      bookTitle: 'Moby',
      extractStatus: status,
      readerState: { sectionIndex: 0, cfi: 'epubcfi(/6/2!/4/2/1:25)' },
      focusChunks: focus,
      sectionChunks: {
        paths: section.paths,
        count: section.count,
        via: 'sectionIndex',
        sectionIndex: 0,
      },
    });
    const system = appendReadingContext(
      buildSystemPrompt({ bookId: 'bk1', bookTitle: 'Moby' }),
      env,
    );
    assert.match(system, /focus_chunks_via: cfi/);
    assert.match(system, /section_chunk_count: 2/);
  });

  it('resolve_section soft-fails when extract is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-eval-miss-'));
    const { createToolParallelBudget } = await import(
      '../src/agent/toolParallelBudget.mjs'
    );
    const parallelBudget = createToolParallelBudget();
    parallelBudget.beginStep();
    const tools = createReadingTools();
    const result = await tools.resolve_section.execute(
      { sectionIndex: 0 },
      {
        toolCallId: 'rs0',
        messages: [],
        context: { bookId: 'bk1', booksRoot: root, parallelBudget },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, 'extract_not_ready');
  });

  it('slash skill expand keeps quote blocks for reading_context peel', () => {
    const root = mkdtempSync(join(tmpdir(), 'eve-eval-skill-'));
    // Bundled skills load without Books overlay.
    const { modelMessage } = expandSkillCommand(
      '> Call me Ishmael.\n\n/skill:explain what does this mean',
      root,
    );
    assert.match(modelMessage, /Call me Ishmael/);
    assert.match(modelMessage, /解释|卡点|白话/i);
    assert.doesNotMatch(modelMessage, /^\/skill:explain/m);
  });
});
