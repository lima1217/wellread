import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatPendingQuotesForTurn,
  parsePendingQuotesFromWire,
  peelLeadingQuoteWire,
  stripLeadingQuoteBlocks,
} from './index.mjs';

describe('formatPendingQuotesForTurn / parsePendingQuotesFromWire', () => {
  it('round-trips quotes + question', () => {
    const quotes = [
      { text: 'selected line', chapterTitle: 'Chapter 1' },
      { text: 'second', chapterTitle: null },
    ];
    const wire = formatPendingQuotesForTurn(quotes, 'What does this mean?');
    assert.equal(
      wire,
      ['> selected line', '> — 《Chapter 1》', '', '> second', '', 'What does this mean?'].join(
        '\n',
      ),
    );
    assert.deepEqual(parsePendingQuotesFromWire(wire), {
      quotes: [
        { text: 'selected line', chapterTitle: 'Chapter 1' },
        { text: 'second', chapterTitle: null },
      ],
      content: 'What does this mean?',
    });
  });

  it('keeps multiline quote text in one block (no blank-line split)', () => {
    const wire = formatPendingQuotesForTurn(
      [{ text: 'line one\n\n> injected\nline two', chapterTitle: 'Ch\nA》' }],
      'ask',
    );
    assert.equal(
      wire,
      [
        '> line one',
        '> > injected',
        '> line two',
        '> — 《Ch A》',
        '',
        'ask',
      ].join('\n'),
    );
    assert.deepEqual(parsePendingQuotesFromWire(wire), {
      quotes: [{ text: 'line one\n> injected\nline two', chapterTitle: 'Ch A' }],
      content: 'ask',
    });
  });

  it('keeps composer leading blockquotes out of the quote peel', () => {
    const wire = formatPendingQuotesForTurn([], '> fake quote\n\nreal question');
    assert.ok(wire.startsWith('\u200B>'));
    assert.deepEqual(parsePendingQuotesFromWire(wire), {
      quotes: [],
      content: '\u200B> fake quote\n\nreal question',
    });
  });

  it('leaves plain user text alone', () => {
    assert.deepEqual(parsePendingQuotesFromWire('Just a question'), {
      quotes: [],
      content: 'Just a question',
    });
  });
});

describe('peelLeadingQuoteWire / stripLeadingQuoteBlocks', () => {
  it('peels quote blocks and leaves the question', () => {
    const wire = '> Call me Ishmael.\n> — 《Chapter 1》\n\nWho is speaking?';
    const peeled = peelLeadingQuoteWire(wire);
    assert.equal(peeled.quoteParts.length, 1);
    assert.equal(peeled.content, 'Who is speaking?');
    assert.equal(stripLeadingQuoteBlocks(wire), 'Who is speaking?');
  });

  it('returns empty string for quote-only wire', () => {
    assert.equal(stripLeadingQuoteBlocks('> Call me Ishmael.\n> — 《Loomings》'), '');
  });
});
