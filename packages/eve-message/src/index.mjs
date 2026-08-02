/**
 * SessionMessage <-> AI SDK UIMessage conversion for Reading Assistant.
 * Shared by eve-sidecar (persist/stream) and readest-app (hydrate/render).
 */

export {
  decodeEveSideChunk,
  encodeEveSideChunk,
  EVE_CONTEXT_COMPRESSED_CHUNK,
  EVE_CONTEXT_COMPRESS_FAILED_CHUNK,
} from './sideEvents.mjs';

/**
 * @typedef {{
 *   id: string,
 *   role: 'user' | 'assistant' | 'system',
 *   content: string,
 *   createdAt: number,
 *   modelContent?: string,
 *   reasoning?: string,
 *   sources?: Array<{ cfi: string, endCfi?: string, title?: string, path?: string }>,
 *   tools?: Array<{ id: string, name: string, args?: unknown, result?: unknown }>,
 *   modelMessages?: unknown[],
 *   compacted?: boolean,
 *   parts?: unknown[],
 * }} SessionMessage
 *
 * @typedef {{
 *   type: 'text',
 *   text: string,
 *   state?: string,
 * } | {
 *   type: 'reasoning',
 *   text: string,
 *   state?: string,
 * } | {
 *   type: 'dynamic-tool',
 *   toolCallId: string,
 *   toolName: string,
 *   state: string,
 *   input?: unknown,
 *   output?: unknown,
 * }} PersistableUIPart
 */

/**
 * Normalize stream/UI parts into a stable disk shape (ordered).
 * tool-* parts collapse to dynamic-tool so reload does not depend on tool names.
 *
 * @param {{ parts?: unknown[] } | null | undefined} msg
 * @returns {PersistableUIPart[]}
 */
export function persistablePartsFromUIMessage(msg) {
  /** @type {PersistableUIPart[]} */
  const out = [];
  for (const part of msg?.parts ?? []) {
    if (!part || typeof part !== 'object') continue;
    const p = /** @type {Record<string, unknown>} */ (part);
    if (p.type === 'text' && typeof p.text === 'string') {
      out.push({
        type: 'text',
        text: p.text,
        ...(typeof p.state === 'string' ? { state: p.state } : { state: 'done' }),
      });
      continue;
    }
    if (p.type === 'reasoning' && typeof p.text === 'string') {
      out.push({
        type: 'reasoning',
        text: p.text,
        ...(typeof p.state === 'string' ? { state: p.state } : { state: 'done' }),
      });
      continue;
    }
    if (p.type === 'dynamic-tool' && typeof p.toolCallId === 'string') {
      out.push({
        type: 'dynamic-tool',
        toolCallId: p.toolCallId,
        toolName: typeof p.toolName === 'string' ? p.toolName : 'tool',
        state: typeof p.state === 'string' ? p.state : 'output-available',
        input: 'input' in p ? p.input : {},
        ...('output' in p ? { output: p.output } : {}),
      });
      continue;
    }
    if (typeof p.type === 'string' && p.type.startsWith('tool-') && typeof p.toolCallId === 'string') {
      out.push({
        type: 'dynamic-tool',
        toolCallId: p.toolCallId,
        toolName: p.type.slice('tool-'.length),
        state: typeof p.state === 'string' ? p.state : 'output-available',
        input: 'input' in p ? p.input : {},
        ...('output' in p ? { output: p.output } : {}),
      });
    }
  }
  return out;
}

/**
 * @param {SessionMessage} msg
 * @returns {import('ai').UIMessage}
 */
export function sessionToUIMessage(msg) {
  const metadata = {
    createdAt: msg.createdAt,
    ...(msg.modelContent ? { modelContent: msg.modelContent } : {}),
    ...(msg.compacted ? { compacted: true } : {}),
    ...(msg.sources?.length ? { sources: msg.sources } : {}),
  };

  if (msg.role === 'user' || msg.role === 'system') {
    const parts =
      msg.parts?.length > 0
        ? persistablePartsFromUIMessage({ parts: msg.parts })
        : msg.content
          ? [{ type: 'text', text: msg.content }]
          : [];
    return {
      id: msg.id,
      role: msg.role,
      metadata,
      parts,
    };
  }

  const parts =
    msg.parts?.length > 0
      ? persistablePartsFromUIMessage({ parts: msg.parts })
      : synthesizePartsFromFlat(msg);

  return {
    id: msg.id,
    role: 'assistant',
    metadata,
    parts,
  };
}

/**
 * @param {SessionMessage} msg
 * @returns {PersistableUIPart[]}
 */
function synthesizePartsFromFlat(msg) {
  /** @type {PersistableUIPart[]} */
  const parts = [];
  if (msg.reasoning?.trim()) {
    parts.push({ type: 'reasoning', text: msg.reasoning, state: 'done' });
  }
  for (const t of msg.tools ?? []) {
    parts.push({
      type: 'dynamic-tool',
      toolName: t.name,
      toolCallId: t.id,
      state: 'output-available',
      input: t.args ?? {},
      output: t.result,
    });
  }
  if (msg.content?.trim()) {
    parts.push({ type: 'text', text: msg.content, state: 'done' });
  }
  return parts;
}

/**
 * @param {import('ai').UIMessage} msg
 * @param {{
 *   modelMessages?: unknown[],
 *   sources?: Array<{ cfi: string, endCfi?: string, title?: string, path?: string }>,
 *   createdAt?: number,
 * }} [extras]
 * @returns {SessionMessage}
 */
export function uiMessageToSession(msg, extras = {}) {
  const parts = persistablePartsFromUIMessage(msg);
  const text = textFromUIMessage(msg);
  const reasoning = reasoningFromUIMessage(msg);
  const tools = toolsFromUIMessage(msg);
  const meta = msg.metadata && typeof msg.metadata === 'object' ? msg.metadata : {};
  const createdAt =
    extras.createdAt ??
    (typeof meta.createdAt === 'number' ? meta.createdAt : Date.now());
  const sources = extras.sources ?? (Array.isArray(meta.sources) ? meta.sources : undefined);
  const compacted = Boolean(meta.compacted);
  const modelContent =
    typeof meta.modelContent === 'string' && meta.modelContent ? meta.modelContent : undefined;

  return {
    id: msg.id,
    role: msg.role === 'system' || msg.role === 'user' ? msg.role : 'assistant',
    content: text,
    createdAt,
    ...(parts.length ? { parts } : {}),
    ...(modelContent ? { modelContent } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(sources?.length ? { sources } : {}),
    ...(tools.length ? { tools } : {}),
    ...(extras.modelMessages ? { modelMessages: extras.modelMessages } : {}),
    ...(compacted ? { compacted: true } : {}),
  };
}

/**
 * @param {{ parts?: Array<{ type: string, text?: string }> } | null | undefined} msg
 */
export function textFromUIMessage(msg) {
  return (msg?.parts ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
}

/**
 * @param {{ parts?: Array<{ type: string, text?: string }> } | null | undefined} msg
 */
export function reasoningFromUIMessage(msg) {
  return (msg?.parts ?? [])
    .filter((p) => p.type === 'reasoning')
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

/**
 * Tool UI parts keep an `output` key even while `state` is still
 * `input-available` / `input-streaming` (value undefined). Treat only
 * finished states as having a result so the client can show Running…
 * during live tool execution (P3-1).
 *
 * @param {Record<string, unknown>} part
 * @returns {unknown | undefined}
 */
function toolResultFromPart(part) {
  const state = typeof part.state === 'string' ? part.state : '';
  if (state === 'input-streaming' || state === 'input-available' || state === 'approval-requested') {
    return undefined;
  }
  if (state === 'output-available' || state === 'output-error' || state === 'approval-responded') {
    return 'output' in part ? part.output : undefined;
  }
  // Legacy / unknown: finished only when output is actually present.
  if ('output' in part && part.output !== undefined) return part.output;
  return undefined;
}

/**
 * @param {{ parts?: unknown[] } | null | undefined} msg
 * @returns {Array<{ id: string, name: string, args?: unknown, result?: unknown }>}
 */
export function toolsFromUIMessage(msg) {
  /** @type {Array<{ id: string, name: string, args?: unknown, result?: unknown }>} */
  const tools = [];
  for (const part of msg?.parts ?? []) {
    if (!part || typeof part !== 'object') continue;
    const p = /** @type {Record<string, unknown>} */ (part);
    if (p.type === 'dynamic-tool' && typeof p.toolCallId === 'string') {
      tools.push({
        id: p.toolCallId,
        name: typeof p.toolName === 'string' ? p.toolName : 'tool',
        args: p.input,
        result: toolResultFromPart(p),
      });
      continue;
    }
    if (typeof p.type === 'string' && p.type.startsWith('tool-') && typeof p.toolCallId === 'string') {
      tools.push({
        id: p.toolCallId,
        name: p.type.slice('tool-'.length),
        args: 'input' in p ? p.input : undefined,
        result: toolResultFromPart(p),
      });
    }
  }
  return tools;
}
