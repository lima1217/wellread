import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CHUNK_FILE_NAME_PATTERN,
  EXTRACT_META_JSON_SCHEMA,
  EXTRACT_SCHEMA_VERSION,
  SECTION_INDEX_JSON_SCHEMA,
  isCurrentExtractSchema,
  isSafeChunkFileName,
} from './index.mjs';

const contractDoc = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/readest-app/docs/reading-assistant-contract.md',
);

describe('extract-contract SSOT', () => {
  it('pins schema version and embeds it in JSON Schemas', () => {
    assert.equal(EXTRACT_SCHEMA_VERSION, 2);
    assert.equal(
      EXTRACT_META_JSON_SCHEMA.properties.schemaVersion.minimum,
      EXTRACT_SCHEMA_VERSION,
    );
    assert.equal(
      SECTION_INDEX_JSON_SCHEMA.properties.schemaVersion.minimum,
      EXTRACT_SCHEMA_VERSION,
    );
  });

  it('accepts chunk file names with more than five digits', () => {
    assert.equal(isSafeChunkFileName('100000-chunk.md'), true);
  });

  it('points reading-assistant-contract.md at this package as schema SSOT', () => {
    const md = readFileSync(contractDoc, 'utf8');
    assert.match(md, /@wellread\/extract-contract/);
    assert.match(md, /EXTRACT_SCHEMA_VERSION/);
    assert.match(md, /EXTRACT_META_JSON_SCHEMA|JSON Schemas/);
  });

  it('accepts host chunk file names and rejects traversal', () => {
    assert.equal(isSafeChunkFileName('00001-loomings.md'), true);
    assert.equal(CHUNK_FILE_NAME_PATTERN.test('00001-loomings.md'), true);
    assert.equal(isSafeChunkFileName('../../../notes/x.md'), false);
    assert.equal(isSafeChunkFileName('00001-A.md'), false);
    assert.equal(isSafeChunkFileName(''), false);
  });

  it('isCurrentExtractSchema gates ready trees', () => {
    assert.equal(isCurrentExtractSchema(EXTRACT_SCHEMA_VERSION), true);
    assert.equal(isCurrentExtractSchema(EXTRACT_SCHEMA_VERSION + 1), true);
    assert.equal(isCurrentExtractSchema(1), false);
    assert.equal(isCurrentExtractSchema(null), false);
  });
});
