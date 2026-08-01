import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ENVELOPE_KEYS,
  normalizeReaderState,
  READER_STATE_CHAPTER_MAX_LENGTH,
  READER_STATE_CFI_MAX_LENGTH,
} from './index.mjs';

describe('normalizeReaderState', () => {
  it('keeps chapter, cfi, and sectionIndex', () => {
    assert.deepEqual(
      normalizeReaderState({ chapter: ' Ch ', cfi: 'epubcfi(/6/4)', sectionIndex: 2.8 }),
      { chapter: 'Ch', cfi: 'epubcfi(/6/4)', sectionIndex: 2 },
    );
  });

  it('rejects oversized CFIs by default', () => {
    const huge = `epubcfi(${'x'.repeat(READER_STATE_CFI_MAX_LENGTH)})`;
    assert.deepEqual(normalizeReaderState({ cfi: huge, chapter: 'A' }), { chapter: 'A' });
  });

  it('truncates oversized chapter titles by default', () => {
    const huge = '章'.repeat(READER_STATE_CHAPTER_MAX_LENGTH + 40);
    assert.deepEqual(normalizeReaderState({ chapter: huge }), {
      chapter: '章'.repeat(READER_STATE_CHAPTER_MAX_LENGTH),
    });
  });

  it('returns null when empty', () => {
    assert.equal(normalizeReaderState({}), null);
    assert.equal(normalizeReaderState(null), null);
  });
});

describe('ENVELOPE_KEYS', () => {
  it('locks wire field names used by the sidecar envelope', () => {
    assert.equal(ENVELOPE_KEYS.extractStatus, 'extract_status');
    assert.equal(ENVELOPE_KEYS.focusChunks, 'focus_chunks');
    assert.equal(ENVELOPE_KEYS.sectionChunks, 'section_chunks');
    assert.equal(ENVELOPE_KEYS.sectionIndex, 'sectionIndex');
  });
});
