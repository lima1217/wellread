import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GREP_LINE_TEXT_MAX,
  projectExtractContentForModel,
  projectGrepHitForModel,
} from './tools.mjs';

describe('projectExtractContentForModel', () => {
  it('keeps cfi/title/endCfi and drops other frontmatter keys', () => {
    const raw = `---
bookId: "bk1"
sectionIndex: 3
title: "Loomings"
cfi: "epubcfi(/6/2!)"
endCfi: "epubcfi(/6/2!/4)"
chunkIndex: 0
---

Call me Ishmael.
`;
    const out = projectExtractContentForModel(raw);
    assert.match(out, /^---\ncfi: "epubcfi\(\/6\/2!\)"\ntitle: "Loomings"\nendCfi: "epubcfi\(\/6\/2!\/4\)"\n---\n/);
    assert.match(out, /Call me Ishmael/);
    assert.doesNotMatch(out, /bookId/);
    assert.doesNotMatch(out, /sectionIndex/);
    assert.doesNotMatch(out, /chunkIndex/);
  });

  it('leaves non-frontmatter content unchanged', () => {
    assert.equal(projectExtractContentForModel('plain'), 'plain');
  });

  it('still yields sources via extractSourcesFromChunkMarkdown', async () => {
    const { extractSourcesFromChunkMarkdown } = await import('./prompt.mjs');
    const raw = `---
bookId: "bk1"
title: "Loomings"
cfi: "epubcfi(/6/2!)"
endCfi: "epubcfi(/6/2!/4)"
chunkIndex: 0
---

Body.
`;
    const projected = projectExtractContentForModel(raw);
    const sources = extractSourcesFromChunkMarkdown(projected, '/workspace/x.md');
    assert.equal(sources.length, 1);
    assert.equal(sources[0].cfi, 'epubcfi(/6/2!)');
    assert.equal(sources[0].title, 'Loomings');
  });
});

describe('projectGrepHitForModel', () => {
  it('truncates long line text', () => {
    const long = 'a'.repeat(GREP_LINE_TEXT_MAX + 20);
    const hit = projectGrepHitForModel({
      path: '/workspace/.wellread/extract/bk/a.md',
      line: 4,
      text: long,
    });
    assert.equal(hit.line, 4);
    assert.equal(hit.text.length, GREP_LINE_TEXT_MAX);
    assert.equal(hit.text.endsWith('…'), true);
  });
});
