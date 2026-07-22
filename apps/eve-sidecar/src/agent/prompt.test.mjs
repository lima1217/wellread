import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSystemPrompt } from './prompt.mjs';

describe('buildSystemPrompt', () => {
  it('injects bookId, extract root, notes root, and steering phrases', () => {
    const prompt = buildSystemPrompt({
      bookId: 'abc123',
      bookTitle: 'Moby Dick',
    });
    assert.match(prompt, /abc123/);
    assert.match(prompt, /Moby Dick/);
    assert.match(prompt, /\/workspace\/\.wellread\/extract\/abc123\//);
    assert.match(prompt, /\/workspace\/\.wellread\/notes\/abc123\//);
    assert.match(prompt, /current book/i);
    assert.match(prompt, /\bExtract:/);
    assert.match(prompt, /\bNotes:/);
    assert.match(prompt, /Grounding is optional/i);
    assert.match(prompt, /answer freely/i);
    assert.match(prompt, /\bcite\b/i);
    assert.match(prompt, /\bcfi\b/i);
    assert.match(prompt, /angle brackets/i);
    assert.match(prompt, /Never write bare paths/i);
    assert.match(prompt, /\[section title\]/i);
    assert.match(prompt, /epubcfi/i);
    assert.match(prompt, /write_file/);
    assert.match(prompt, /unavailable until mounted/);
    assert.match(prompt, /no emoji/i);
  });

  it('falls back to bookId when title is empty', () => {
    const prompt = buildSystemPrompt({ bookId: 'bk1', bookTitle: '  ' });
    assert.match(prompt, /Current book: "bk1"/);
  });
});
