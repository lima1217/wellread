import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { prepareUserTurn } from './userTurn.mjs';

describe('prepareUserTurn', () => {
  it('keeps session slash text and strips quotes from model content', () => {
    const wire = '> Call me Ishmael.\n> — 《Chapter 1》\n\nWho is speaking?';
    const prepared = prepareUserTurn(wire, () => {
      throw new Error('books root unused for plain turns');
    });
    assert.equal(prepared.sessionContent, wire);
    assert.equal(prepared.modelContent, 'Who is speaking?');
    assert.equal(prepared.quotes.length, 1);
    assert.equal(prepared.quotes[0].text, 'Call me Ishmael.');
  });

  it('tolerates getBooksRoot failures for slash turns', () => {
    const prepared = prepareUserTurn('/skill:note draft this', () => {
      throw new Error('EVE_BOOKS_ROOT is not set');
    });
    assert.equal(prepared.sessionContent, '/skill:note draft this');
    assert.equal(prepared.modelContent, '/skill:note draft this');
  });
});
