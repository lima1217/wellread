/**
 * Detect soft-landing / final-answer degeneration (ellipsis loops, "let me
 * continue" theater) so those blobs never land in session history.
 */

/** Ignore short answers — literary ellipsis in a normal reply is fine. */
export const DEGENERATE_MIN_LENGTH = 200;

/**
 * @param {unknown} text
 * @returns {boolean}
 */
export function isDegenerateAnswer(text) {
  if (typeof text !== 'string') return false;
  const s = text;
  if (s.length < DEGENERATE_MIN_LENGTH) return false;

  let ellip = 0;
  for (const ch of s) {
    if (ch === '…' || ch === '⋯') ellip += 1;
  }
  const ellipRatio = ellip / s.length;
  const stripped = s.replace(/[….·.\s]/gu, '');
  const continueHits = (s.match(/让我继续|请继续|请让我继续|继续阅读/g) || [])
    .length;
  const omitHits = (s.match(/（中间略）|\(中间略\)/g) || []).length;

  if (stripped.length < 80 && s.length > 500) return true;
  if (ellipRatio >= 0.4 && (continueHits >= 5 || omitHits >= 5)) return true;
  if (continueHits >= 15) return true;
  if (ellipRatio >= 0.6 && stripped.length < 400) return true;
  return false;
}
