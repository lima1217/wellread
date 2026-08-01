/**
 * Pending Quote wire format shared by readest-app (compose/hydrate) and eve-sidecar (peel/envelope).
 * Docs: apps/readest-app/docs/reading-assistant-contract.md
 */

const CHAPTER_ATTR = /^— 《(.+)》$/;

/**
 * @typedef {{ text: string, chapterTitle?: string | null }} PendingQuoteForTurn
 */

/**
 * Flatten quote body so a single Pending Quote stays one wire block:
 * no blank lines (would split peel on \\n\\n) and each line is one `> …` row.
 * @param {string} text
 * @returns {string[]}
 */
function quoteTextLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Chapter attr is a single wire line `> — 《…》`; collapse newlines and strip
 * book-title brackets so CHAPTER_ATTR cannot be confused.
 * @param {string} chapter
 */
function sanitizeChapterTitle(chapter) {
  return String(chapter ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[《》]/g, '')
    .trim();
}

/**
 * Composer questions must not be peeled as Pending Quotes. A leading U+200B
 * keeps markdown-looking `>` lines in `content` instead of the envelope.
 * @param {string} question
 */
function protectComposerQuestion(question) {
  const q = (question ?? '').trim();
  if (!q) return '';
  if (!q.startsWith('>')) return q;
  return `\u200B${q}`;
}

/**
 * Wire content for an eve turn: Pending Quote blockquotes + user question.
 * @param {PendingQuoteForTurn[]} quotes
 * @param {string} userText
 */
export function formatPendingQuotesForTurn(quotes, userText) {
  const question = protectComposerQuestion(userText);
  const list = Array.isArray(quotes) ? quotes : [];
  const blocks = list.flatMap((q) => {
    const lines = quoteTextLines(q?.text ?? '').map((line) => `> ${line}`);
    if (!lines.length) return [];
    const chapter = sanitizeChapterTitle(q.chapterTitle ?? '');
    if (chapter) {
      lines.push(`> — 《${chapter}》`);
    }
    return [lines.join('\n')];
  });
  return [...blocks, question].filter(Boolean).join('\n\n');
}

/**
 * Split leading Pending Quote `> …` blocks from the trailing question.
 * Quote parts keep original wire segments (for skill expand reassembly).
 * @param {string} wire
 * @returns {{ quoteParts: string[], content: string }}
 */
export function peelLeadingQuoteWire(wire) {
  const trimmed = typeof wire === 'string' ? wire.trim() : '';
  if (!trimmed) return { quoteParts: [], content: '' };
  if (!trimmed.startsWith('>')) return { quoteParts: [], content: trimmed };

  const parts = trimmed.split(/\n\n+/);
  /** @type {string[]} */
  const quoteParts = [];
  let i = 0;
  for (; i < parts.length; i++) {
    const block = (parts[i] || '').trim();
    if (!block) continue;
    const lines = block.split('\n');
    if (!lines.every((line) => line.startsWith('>'))) break;
    quoteParts.push(parts[i]);
  }

  const content = parts.slice(i).join('\n\n').trim();
  return {
    quoteParts,
    content: content || (quoteParts.length ? '' : trimmed),
  };
}

/**
 * Peel leading Pending Quote blockquotes from wire text into QuoteStack fields.
 * @param {string} wire
 * @returns {{
 *   quotes: Array<{ text: string, chapterTitle: string | null }>,
 *   content: string,
 * }}
 */
export function parsePendingQuotesFromWire(wire) {
  const { quoteParts, content } = peelLeadingQuoteWire(wire);
  /** @type {Array<{ text: string, chapterTitle: string | null }>} */
  const quotes = [];
  for (const part of quoteParts) {
    const block = (part || '').trim();
    if (!block) continue;
    const lines = block.split('\n');
    /** @type {string | null} */
    let chapterTitle = null;
    /** @type {string[]} */
    const textLines = [];
    for (const line of lines) {
      const body = line.replace(/^>\s?/, '');
      const chapterMatch = CHAPTER_ATTR.exec(body);
      if (chapterMatch) {
        chapterTitle = chapterMatch[1] ?? null;
      } else {
        textLines.push(body);
      }
    }
    const text = textLines.join('\n').trim();
    if (text) quotes.push({ text, chapterTitle });
  }
  return { quotes, content };
}

/**
 * Strip leading Pending Quote blocks so quotes live only in the envelope.
 * @param {string} message
 */
export function stripLeadingQuoteBlocks(message) {
  return peelLeadingQuoteWire(message).content;
}
