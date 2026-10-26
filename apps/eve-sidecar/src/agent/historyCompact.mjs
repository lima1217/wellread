/**
 * Replay-time compaction of large tool results from earlier turns.
 *
 * Whole-section reads (read_section_text can return up to 1 MiB) would
 * otherwise ride every later request until context compression kicks in.
 * Earlier turns are compacted deterministically (same input → same bytes), so
 * the replayed prefix stays stable for provider prompt caching. The current
 * turn's own tool steps are never touched: they live inside streamText.
 */

/** Tool results larger than this (serialized chars) are stubbed on replay. */
export const HISTORY_TOOL_RESULT_MAX_CHARS = 4000;

/** Leading text kept from a compacted body (frontmatter carries the cfi). */
export const HISTORY_TOOL_EXCERPT_CHARS = 480;

/** Scalar locator fields kept verbatim so the model can re-read precisely. */
const KEEP_KEYS = [
  'ok',
  'error',
  'path',
  'title',
  'sectionIndex',
  'chunkCount',
  'count',
  'via',
  'truncated',
];

const COMPACT_NOTE =
  'Large result from an earlier turn omitted from replay; call the tool again with the same arguments to re-read it.';

/**
 * @param {unknown} value
 * @returns {number}
 */
function serializedLength(value) {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * @param {unknown} value tool result payload (usually the `{ ok, ... }` envelope)
 * @returns {unknown}
 */
export function compactToolResultValue(value) {
  if (serializedLength(value) <= HISTORY_TOOL_RESULT_MAX_CHARS) return value;
  /** @type {Record<string, unknown>} */
  const out = { compacted: true, note: COMPACT_NOTE };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rec = /** @type {Record<string, unknown>} */ (value);
    for (const key of KEEP_KEYS) {
      const v = rec[key];
      if (v === undefined) continue;
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
        out[key] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 199)}…` : v;
      }
    }
    if (Array.isArray(rec.paths)) {
      out.paths = rec.paths.slice(0, 8);
      if (rec.paths.length > 8) out.pathsOmitted = rec.paths.length - 8;
    }
    if (Array.isArray(rec.hits)) {
      out.hitCount = rec.hits.length;
      out.hits = rec.hits.slice(0, 5);
    }
    const body =
      typeof rec.text === 'string'
        ? rec.text
        : typeof rec.content === 'string'
          ? rec.content
          : '';
    if (body) {
      out.excerpt = `${body.slice(0, HISTORY_TOOL_EXCERPT_CHARS).trimEnd()}…`;
      out.omittedChars = Math.max(0, body.length - HISTORY_TOOL_EXCERPT_CHARS);
    }
    // Hits/paths kept above can still be large; fall back to the bare stub.
    if (serializedLength(out) > HISTORY_TOOL_RESULT_MAX_CHARS) {
      delete out.hits;
      delete out.paths;
    }
    return out;
  }
  if (typeof value === 'string') {
    out.excerpt = `${value.slice(0, HISTORY_TOOL_EXCERPT_CHARS).trimEnd()}…`;
    out.omittedChars = Math.max(0, value.length - HISTORY_TOOL_EXCERPT_CHARS);
  }
  return out;
}

/**
 * @param {unknown} output AI SDK ToolResultOutput (`{ type: 'json' | 'text', value }`)
 * @returns {unknown}
 */
export function compactToolResultOutput(output) {
  if (!output || typeof output !== 'object') return output;
  const rec = /** @type {{ type?: unknown, value?: unknown }} */ (output);
  if (rec.type === 'json') {
    const value = compactToolResultValue(rec.value);
    return value === rec.value ? output : { type: 'json', value };
  }
  if (rec.type === 'text' && typeof rec.value === 'string') {
    if (rec.value.length <= HISTORY_TOOL_RESULT_MAX_CHARS) return output;
    return { type: 'json', value: compactToolResultValue(rec.value) };
  }
  return output;
}

/**
 * Compact `role: 'tool'` result parts of replayed model messages. Assistant
 * parts (reasoning, provider-executed web_search) pass through untouched.
 *
 * @param {import('ai').ModelMessage[]} messages
 * @returns {import('ai').ModelMessage[]}
 */
export function compactHistoryToolResults(messages) {
  return messages.map((message) => {
    if (!message || message.role !== 'tool' || !Array.isArray(message.content)) {
      return message;
    }
    let changed = false;
    const content = message.content.map((part) => {
      if (!part || part.type !== 'tool-result') return part;
      const output = compactToolResultOutput(part.output);
      if (output === part.output) return part;
      changed = true;
      return { ...part, output };
    });
    return changed
      ? /** @type {import('ai').ModelMessage} */ ({ ...message, content })
      : message;
  });
}
