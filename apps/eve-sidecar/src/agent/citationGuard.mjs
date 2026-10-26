/**
 * Citation guard: drop `[label](<epubcfi(...)>)` links whose cfi the model
 * never saw, so a guessed or edited cfi cannot send the reader to the wrong
 * passage.
 *
 * A cfi counts as seen when it appears in this turn's tool output, in the
 * persisted reading context / tool results of earlier turns, or is an exact
 * chunk boundary in this book's section index (covers results lost to replay
 * compaction or context compression). Assistant prose is never a source: a
 * citation the model invented earlier must not vouch for itself now.
 */

import { loadSectionIndex, chunkWorkspacePath } from './sectionIndex.mjs';

/** Longest cfi the stream filter waits for before giving up on a link. */
const CITATION_MAX_CHARS = 4096;
/** Longest link label considered a citation label. */
const LABEL_MAX_CHARS = 300;

const CFI_OPEN = 'epubcfi(';

/**
 * Index just past the `)` that closes the `epubcfi(` whose body starts at
 * `from`, or -1 when the text ends first. `^` escapes the next character.
 * @param {string} text
 * @param {number} from
 */
function cfiBodyEnd(text, from) {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '^') {
      i += 1;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Comparable identity of a cfi: the body inside `epubcfi(…)`, trimmed.
 * @param {string} cfi
 */
export function cfiKey(cfi) {
  const t = String(cfi ?? '').trim();
  const m = t.match(/^epubcfi\(([\s\S]*)\)$/i);
  return (m ? m[1] : t).trim();
}

/**
 * Every `epubcfi(…)` in free text, as cfiKey identities.
 * @param {string} text
 * @returns {string[]}
 */
export function extractCfiKeys(text) {
  if (typeof text !== 'string' || !text) return [];
  /** @type {string[]} */
  const out = [];
  const lower = text.toLowerCase();
  let at = lower.indexOf(CFI_OPEN);
  while (at >= 0) {
    const bodyStart = at + CFI_OPEN.length;
    const end = cfiBodyEnd(text, bodyStart);
    if (end < 0) break;
    const key = text.slice(bodyStart, end - 1).trim();
    if (key) out.push(key);
    at = lower.indexOf(CFI_OPEN, end);
  }
  return out;
}

/**
 * Remove `epubcfi(…)` spans (and the link shells they leave) from text that
 * comes from another book, where a cfi would point at the wrong passage.
 * @param {string} text
 */
export function stripCfis(text) {
  if (typeof text !== 'string' || !text) return text;
  const lower = text.toLowerCase();
  let out = '';
  let from = 0;
  let at = lower.indexOf(CFI_OPEN);
  while (at >= 0) {
    const end = cfiBodyEnd(text, at + CFI_OPEN.length);
    if (end < 0) break;
    out += text.slice(from, at);
    from = end;
    at = lower.indexOf(CFI_OPEN, end);
  }
  out += text.slice(from);
  return out
    .replace(/\]\(<?\s*>?\)/g, ']')
    .replace(/^cfi:\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Workspace path of another book's .wellread package file, or null.
 * @param {unknown} path
 * @param {string} bookId current book
 * @returns {string | null} the other bookId
 */
export function otherBookOfPath(path, bookId) {
  if (typeof path !== 'string') return null;
  const m = path.match(
    /^\/workspace\/\.wellread\/(?:notes\/([^/]+)\/|annotations\/([^/]+)\.md$|memory\/books\/([^/]+)\.md$)/,
  );
  if (!m) return null;
  const owner = m[1] ?? m[2] ?? m[3];
  return owner && owner !== bookId ? owner : null;
}

/**
 * Whether a tool result may vouch for citations in this book.
 * search_library and reads of other books' packages carry cfi values that
 * belong to those books.
 * @param {string | undefined} toolName
 * @param {unknown} args
 * @param {string} bookId
 */
export function toolVouchesForBook(toolName, args, bookId) {
  if (toolName === 'search_library') return false;
  if (toolName === 'read_file') {
    const path =
      args && typeof args === 'object' ? /** @type {{ path?: unknown }} */ (args).path : null;
    if (otherBookOfPath(path, bookId)) return false;
  }
  return true;
}

/**
 * @param {unknown} value
 */
function safeJson(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/**
 * @typedef {{
 *   addText: (text: unknown) => void,
 *   addToolResult: (toolName: string | undefined, args: unknown, result: unknown) => void,
 *   isKnown: (cfi: string) => boolean,
 * }} CitationVerifier
 */

/**
 * @param {{
 *   booksRoot?: string,
 *   bookId: string,
 *   spoilerGuard?: { isPathHidden: (workspacePath: string) => boolean } | null,
 *   messages?: Array<{
 *     role?: string,
 *     content?: string,
 *     modelContent?: string,
 *     tools?: Array<{ name?: string, args?: unknown, result?: unknown }>,
 *     sources?: Array<{ cfi?: string, endCfi?: string }>,
 *     modelMessages?: unknown[],
 *   }>,
 *   currentUserModelContent?: string,
 * }} input
 * @returns {CitationVerifier}
 */
export function createCitationVerifier(input) {
  const { bookId } = input;
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Map<string, string> | null} cfi key → chunk workspace path */
  let indexKeys = null;

  const addText = (/** @type {unknown} */ text) => {
    for (const key of extractCfiKeys(safeJson(text))) seen.add(key);
  };
  /**
   * @param {string | undefined} toolName
   * @param {unknown} args
   * @param {unknown} result
   */
  const addToolResult = (toolName, args, result) => {
    if (toolVouchesForBook(toolName, args, bookId)) addText(result);
  };

  for (const m of input.messages ?? []) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'user') {
      addText(typeof m.modelContent === 'string' && m.modelContent ? m.modelContent : m.content);
      continue;
    }
    if (m.role !== 'assistant') continue;
    for (const src of m.sources ?? []) {
      if (src?.cfi) seen.add(cfiKey(src.cfi));
      if (src?.endCfi) seen.add(cfiKey(src.endCfi));
    }
    for (const t of m.tools ?? []) {
      if (t && typeof t === 'object') addToolResult(t.name, t.args, t.result);
    }
    collectModelToolResults(m.modelMessages, addToolResult);
  }
  if (input.currentUserModelContent) addText(input.currentUserModelContent);

  /** @param {string} key */
  const knownInIndex = (key) => {
    if (indexKeys === null) {
      indexKeys = new Map();
      const index = input.booksRoot ? loadSectionIndex(input.booksRoot, bookId) : null;
      for (const rows of Object.values(index?.sections ?? {})) {
        for (const row of rows) {
          const path = chunkWorkspacePath(bookId, row.fileName);
          if (row.cfi) indexKeys.set(cfiKey(row.cfi), path);
          if (row.endCfi) indexKeys.set(cfiKey(row.endCfi), path);
        }
      }
    }
    const path = indexKeys.get(key);
    if (!path) return false;
    return !input.spoilerGuard?.isPathHidden(path);
  };

  return {
    addText,
    addToolResult,
    isKnown(cfi) {
      const key = cfiKey(cfi);
      if (!key) return false;
      return seen.has(key) || knownInIndex(key);
    },
  };
}

/**
 * Feed `role: 'tool'` parts of persisted model messages to the verifier,
 * pairing each result with its tool-call args.
 * @param {unknown[] | undefined} modelMessages
 * @param {(toolName: string | undefined, args: unknown, result: unknown) => void} add
 */
function collectModelToolResults(modelMessages, add) {
  if (!Array.isArray(modelMessages)) return;
  /** @type {Map<string, unknown>} */
  const argsById = new Map();
  for (const row of modelMessages) {
    const msg = /** @type {{ role?: string, content?: unknown }} */ (row);
    if (!msg || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (!part || typeof part !== 'object') continue;
      const p = /** @type {Record<string, unknown>} */ (part);
      if (msg.role === 'assistant' && p.type === 'tool-call' && typeof p.toolCallId === 'string') {
        argsById.set(p.toolCallId, p.input);
      }
      if (msg.role === 'tool' && p.type === 'tool-result') {
        const id = typeof p.toolCallId === 'string' ? p.toolCallId : '';
        add(
          typeof p.toolName === 'string' ? p.toolName : undefined,
          argsById.get(id),
          p.output,
        );
      }
    }
  }
}

/**
 * Parse a markdown citation link starting at `start` (`text[start] === '['`).
 * @param {string} text
 * @param {number} start
 * @returns {{ status: 'more' } | { status: 'no' } | { status: 'link', end: number, cfi: string }}
 */
export function parseCitationAt(text, start) {
  let i = start + 1;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === ']') break;
    if (ch === '\n' || ch === '[') return { status: 'no' };
    if (i - start > LABEL_MAX_CHARS) return { status: 'no' };
  }
  if (i >= text.length) return { status: 'more' };
  i += 1; // past ]
  if (i >= text.length) return { status: 'more' };
  if (text[i] !== '(') return { status: 'no' };
  i += 1;
  let angle = false;
  if (i >= text.length) return { status: 'more' };
  if (text[i] === '<') {
    angle = true;
    i += 1;
  }
  const head = text.slice(i, i + CFI_OPEN.length).toLowerCase();
  if (head.length < CFI_OPEN.length) {
    return CFI_OPEN.startsWith(head) ? { status: 'more' } : { status: 'no' };
  }
  if (head !== CFI_OPEN) return { status: 'no' };
  const bodyStart = i + CFI_OPEN.length;
  const bodyEnd = cfiBodyEnd(text, bodyStart);
  if (bodyEnd < 0) {
    return text.length - start > CITATION_MAX_CHARS ? { status: 'no' } : { status: 'more' };
  }
  const cfi = text.slice(i, bodyEnd);
  let j = bodyEnd;
  if (angle) {
    if (j >= text.length) return { status: 'more' };
    if (text[j] !== '>') return { status: 'no' };
    j += 1;
  }
  if (j >= text.length) return { status: 'more' };
  if (text[j] !== ')') return { status: 'no' };
  return { status: 'link', end: j + 1, cfi };
}

/**
 * Filter citations in buffered text. Returns the text safe to emit now and
 * the tail still waiting for a link to complete.
 * @param {string} buf
 * @param {(cfi: string) => boolean} isKnown
 * @param {boolean} final no more text will arrive for this part
 * @returns {{ out: string, rest: string, dropped: number }}
 */
export function filterCitationText(buf, isKnown, final) {
  let out = '';
  let dropped = 0;
  let i = 0;
  while (i < buf.length) {
    const b = buf.indexOf('[', i);
    if (b < 0) {
      out += buf.slice(i);
      i = buf.length;
      break;
    }
    out += buf.slice(i, b);
    const r = parseCitationAt(buf, b);
    if (r.status === 'more') {
      if (final) {
        out += buf.slice(b);
        i = buf.length;
      } else {
        i = b;
      }
      break;
    }
    if (r.status === 'no') {
      out += '[';
      i = b + 1;
      continue;
    }
    if (isKnown(r.cfi)) {
      out += buf.slice(b, r.end);
    } else {
      dropped += 1;
      out = out.replace(/[ \t]+$/, '');
    }
    i = r.end;
  }
  let rest = buf.slice(i);
  if (!final) {
    // Hold trailing spaces: a dropped citation in the next delta trims them.
    const trail = out.match(/[ \t]+$/)?.[0] ?? '';
    if (trail) {
      out = out.slice(0, -trail.length);
      rest = trail + rest;
    }
  }
  return { out, rest, dropped };
}

/**
 * UIMessage chunk transform: feeds tool outputs to the verifier and drops
 * unverified citation links from text parts as they stream.
 *
 * @template T
 * @param {ReadableStream<T>} stream
 * @param {CitationVerifier} verifier
 * @param {{ onDropped?: (count: number) => void }} [opts]
 * @returns {ReadableStream<T>}
 */
export function filterUnverifiedCitationsStream(stream, verifier, opts = {}) {
  /** @type {Map<string, string>} text part id → held text */
  const held = new Map();
  /** @type {Map<string, { name?: string, args?: unknown }>} */
  const calls = new Map();
  let dropped = 0;
  const isKnown = (/** @type {string} */ cfi) => verifier.isKnown(cfi);

  return stream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        const row = /** @type {Record<string, any>} */ (chunk);
        if (!row || typeof row !== 'object') {
          controller.enqueue(chunk);
          return;
        }
        if (row.type === 'tool-input-available') {
          calls.set(row.toolCallId, { name: row.toolName, args: row.input });
        } else if (row.type === 'tool-output-available') {
          const call = calls.get(row.toolCallId);
          verifier.addToolResult(call?.name, call?.args, row.output);
        } else if (row.type === 'text-delta' && typeof row.id === 'string') {
          const buf = (held.get(row.id) ?? '') + (typeof row.delta === 'string' ? row.delta : '');
          const r = filterCitationText(buf, isKnown, false);
          dropped += r.dropped;
          held.set(row.id, r.rest);
          if (r.out) controller.enqueue(/** @type {T} */ ({ ...row, delta: r.out }));
          return;
        } else if (row.type === 'text-end' && typeof row.id === 'string') {
          const buf = held.get(row.id) ?? '';
          held.delete(row.id);
          if (buf) {
            const r = filterCitationText(buf, isKnown, true);
            dropped += r.dropped;
            if (r.out) {
              controller.enqueue(
                /** @type {T} */ ({ type: 'text-delta', id: row.id, delta: r.out }),
              );
            }
          }
        }
        controller.enqueue(chunk);
      },
      flush(controller) {
        for (const [id, buf] of held) {
          if (!buf) continue;
          const r = filterCitationText(buf, isKnown, true);
          dropped += r.dropped;
          if (r.out) {
            controller.enqueue(/** @type {T} */ ({ type: 'text-delta', id, delta: r.out }));
          }
        }
        held.clear();
        if (dropped) opts.onDropped?.(dropped);
      },
    }),
  );
}
