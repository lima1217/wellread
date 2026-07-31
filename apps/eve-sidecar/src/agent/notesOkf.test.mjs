import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OKF_NOTES_DIRS,
  OKF_NOTES_ROOT_FILES,
  isSafeBookIdSegment,
  notesPackageWorkspaceRoot,
} from './notesOkf.mjs';

describe('notesOkf SSOT', () => {
  it('exposes writable roots without AGENTS or tools', () => {
    assert.deepEqual([...OKF_NOTES_ROOT_FILES], ['index.md', 'log.md']);
    assert.ok(!OKF_NOTES_DIRS.includes('tools'));
  });

  it('builds notes package workspace root for safe book ids', () => {
    assert.equal(notesPackageWorkspaceRoot('bk1'), '/workspace/.wellread/notes/bk1');
    assert.equal(notesPackageWorkspaceRoot('../x'), null);
    assert.equal(isSafeBookIdSegment('bk1'), true);
  });

  it('accepts plain book ids and rejects path-like values', () => {
    assert.equal(isSafeBookIdSegment('book-a_2'), true);
    assert.equal(isSafeBookIdSegment(''), false);
    assert.equal(isSafeBookIdSegment('  bk1'), false);
    assert.equal(isSafeBookIdSegment('.'), false);
    assert.equal(isSafeBookIdSegment('..'), false);
    assert.equal(isSafeBookIdSegment('../extract/x'), false);
    assert.equal(isSafeBookIdSegment('a/b'), false);
    assert.equal(isSafeBookIdSegment('a\\b'), false);
    assert.equal(isSafeBookIdSegment('bk\ninjected'), false);
  });
});
