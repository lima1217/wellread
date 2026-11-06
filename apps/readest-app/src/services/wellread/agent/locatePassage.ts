/**
 * Find a quoted passage in a section document and return its DOM Range, so an
 * external agent's quote (copied from extract text) becomes the same CFI the
 * reader's own selection would produce. Matching ignores whitespace runs,
 * soft hyphens / zero-width characters and curly-vs-straight quotes, and
 * falls back to case-insensitive; it spans text nodes and elements.
 */

import { collectTextNodes, offsetToNode } from '@/services/wellread/extract/CfiChunker';

const INVISIBLE = /[­​-‍⁠﻿]/;
const FOLD: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '″': '"',
};

/** Normalized text plus, per normalized char, its offset in the source string. */
function normalize(source: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (INVISIBLE.test(ch)) continue;
    if (/\s/.test(ch)) {
      if (!inSpace) {
        text += ' ';
        map.push(i);
      }
      inSpace = true;
      continue;
    }
    inSpace = false;
    text += FOLD[ch] ?? ch;
    map.push(i);
  }
  return { text, map };
}

function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    out.push(at);
  }
  return out;
}

/**
 * @param anchor optional position hint (e.g. the extract chunk's cfi resolved
 *   in this document): the first match at or after it wins, else the last before it.
 */
export function locatePassage(doc: Document, passage: string, anchor?: Range | null): Range | null {
  const needle = normalize(passage).text.trim();
  if (!needle) return null;
  const { slices, flatText } = collectTextNodes(doc);
  const hay = normalize(flatText);

  let starts = occurrences(hay.text, needle);
  if (!starts.length) starts = occurrences(hay.text.toLowerCase(), needle.toLowerCase());
  if (!starts.length) return null;

  const toRange = (start: number): Range | null => {
    const from = offsetToNode(slices, hay.map[start]!);
    const to = offsetToNode(slices, hay.map[start + needle.length - 1]! + 1);
    if (!from || !to) return null;
    const range = doc.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  };

  const ranges = starts.map(toRange).filter((r): r is Range => r !== null);
  if (!anchor || ranges.length < 2) return ranges[0] ?? null;
  const after = ranges.find((r) => r.compareBoundaryPoints(Range.START_TO_START, anchor) >= 0);
  return after ?? ranges[ranges.length - 1]!;
}
