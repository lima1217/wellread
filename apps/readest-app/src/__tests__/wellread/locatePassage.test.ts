import { describe, expect, it } from 'vitest';
import { locatePassage } from '@/services/wellread/agent/locatePassage';

function doc(html: string): Document {
  return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
}

describe('locatePassage', () => {
  it('finds a passage that spans several text nodes and elements', () => {
    const d = doc('<p>Call me <em>Ishmael</em>. Some years ago,</p><p>never mind how long.</p>');
    const range = locatePassage(d, 'me Ishmael. Some years');
    expect(range?.toString()).toBe('me Ishmael. Some years');
  });

  it('tolerates whitespace, soft hyphens and curly quotes differences', () => {
    const d = doc(
      '<p>It was the  best\n of times, it was the wor­st of times,</p><p>‘we had everything’</p>',
    );
    expect(locatePassage(d, 'best of times, it was the worst')?.toString()).toBe(
      'best\n of times, it was the wor­st',
    );
    expect(locatePassage(d, "'we had everything'")?.toString()).toBe('‘we had everything’');
  });

  it('falls back to a case-insensitive match', () => {
    const d = doc('<p>The WHALE surfaced.</p>');
    expect(locatePassage(d, 'the whale')?.toString()).toBe('The WHALE');
  });

  it('picks the occurrence at or after the anchor', () => {
    const d = doc('<p id="a">the sea</p><p id="b">far out</p><p id="c">the sea</p>');
    const anchor = d.createRange();
    anchor.setStart(d.getElementById('b')!.firstChild!, 0);
    const range = locatePassage(d, 'the sea', anchor);
    expect(range?.startContainer.parentElement?.id).toBe('c');
    const late = d.createRange();
    late.setStart(d.getElementById('c')!.firstChild!, 3);
    expect(locatePassage(d, 'the sea', late)?.startContainer.parentElement?.id).toBe('c');
  });

  it('returns null when the passage is not in the document', () => {
    expect(locatePassage(doc('<p>Call me Ishmael.</p>'), 'Queequeg')).toBeNull();
    expect(locatePassage(doc('<p>x</p>'), '   ')).toBeNull();
  });
});
