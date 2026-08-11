/**
 * DeepSeek Responses is store:false. @ai-sdk/openai drops providerExecuted
 * web_search tool-calls from the wire input, but DeepSeek needs
 * `web_search_call` items passed back so the server can restore results.
 */

/**
 * @typedef {{ type: 'web_search_call', id: string, status?: string, action?: unknown }} WebSearchCallItem
 */

/**
 * @param {unknown} name
 * @returns {boolean}
 */
export function isWebSearchToolName(name) {
  return (
    name === 'web_search' ||
    name === 'openai.web_search' ||
    name === 'web_search_preview' ||
    name === 'openai.web_search_preview'
  );
}

/**
 * Append incoming calls into `target` (mutates), deduping by id. When an
 * incoming call carries the full server `action` shape and the target only
 * holds a simplified placeholder with the same id, the placeholder is
 * upgraded in place (strict gateways reject `web_search_call` without
 * `action`, so the real item must win).
 *
 * @param {WebSearchCallItem[]} target
 * @param {WebSearchCallItem[]} incoming
 * @returns {WebSearchCallItem[]}
 */
export function mergeWebSearchCalls(target, incoming) {
  if (!Array.isArray(target) || !Array.isArray(incoming) || !incoming.length) {
    return target;
  }
  for (const call of incoming) {
    if (!call || typeof call !== 'object' || typeof call.id !== 'string' || !call.id) {
      continue;
    }
    const idx = target.findIndex((c) => c && c.id === call.id);
    if (idx >= 0) {
      const existing = target[idx];
      if (existing && existing.action == null && call.action != null) {
        target[idx] = call;
      }
      continue;
    }
    target.push(call);
  }
  return target;
}

/**
 * Capture a real server-emitted `web_search_call` item (with its `action`)
 * so replay sends back exactly the shape the gateway accepted. Upgrades a
 * simplified placeholder with the same id in place; items without `action`
 * are ignored so hosts that emit action-less calls keep the fallback path.
 *
 * @param {WebSearchCallItem[] | undefined} target
 * @param {unknown} item
 * @returns {void}
 */
export function captureWebSearchCall(target, item) {
  if (!Array.isArray(target) || !item || typeof item !== 'object') return;
  const row = /** @type {Record<string, unknown>} */ (item);
  if (row.type !== 'web_search_call') return;
  const id = typeof row.id === 'string' ? row.id : '';
  if (!id || row.action == null) return;
  const call = /** @type {WebSearchCallItem} */ (row);
  const idx = target.findIndex((c) => c && c.id === id);
  if (idx >= 0) {
    const existing = target[idx];
    if (existing && existing.action == null) {
      target[idx] = call;
    }
    return;
  }
  target.push(call);
}

/**
 * Collect web_search_call items from AI SDK ModelMessage history (chronological).
 *
 * @param {unknown[]} messages
 * @returns {WebSearchCallItem[]}
 */
export function collectWebSearchCallsForReplay(messages) {
  /** @type {WebSearchCallItem[]} */
  const out = [];
  const seen = new Set();
  if (!Array.isArray(messages)) return out;

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (message);
    const parts = Array.isArray(row.content)
      ? row.content
      : Array.isArray(row.parts)
        ? row.parts
        : null;
    if (!parts) continue;
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const p = /** @type {Record<string, unknown>} */ (part);
      if (p.type !== 'tool-call') continue;
      if (!isWebSearchToolName(p.toolName)) continue;
      const id = typeof p.toolCallId === 'string' ? p.toolCallId : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ type: 'web_search_call', id, status: 'completed' });
    }
  }
  return out;
}

/**
 * Fallback when `modelMessages` omit provider tool-calls but session `tools` still
 * recorded a web_search id (legacy / partial persist).
 *
 * @param {Array<{ tools?: Array<{ id?: string, name?: string }> }>} messages
 * @returns {WebSearchCallItem[]}
 */
export function collectWebSearchCallsFromToolTraces(messages) {
  /** @type {WebSearchCallItem[]} */
  const out = [];
  const seen = new Set();
  if (!Array.isArray(messages)) return out;
  for (const message of messages) {
    if (!message || !Array.isArray(message.tools)) continue;
    for (const tool of message.tools) {
      if (!isWebSearchToolName(tool?.name)) continue;
      const id = typeof tool.id === 'string' ? tool.id : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ type: 'web_search_call', id, status: 'completed' });
    }
  }
  return out;
}

/**
 * Insert missing web_search_call items before the latest user turn in Responses input.
 *
 * @param {unknown[]} input
 * @param {WebSearchCallItem[]} calls
 * @returns {unknown[]}
 */
export function injectWebSearchCallsIntoInput(input, calls) {
  if (!Array.isArray(input) || !Array.isArray(calls) || calls.length === 0) {
    return input;
  }
  const existing = new Set();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (item);
    if (row.type === 'web_search_call' && typeof row.id === 'string' && row.id) {
      existing.add(row.id);
    }
  }
  const toAdd = calls.filter((c) => c?.id && !existing.has(c.id));
  if (!toAdd.length) return input;

  let insertAt = input.length;
  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i];
    if (!item || typeof item !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (item);
    if (row.role === 'user') {
      insertAt = i;
      break;
    }
  }
  return [...input.slice(0, insertAt), ...toAdd, ...input.slice(insertAt)];
}
