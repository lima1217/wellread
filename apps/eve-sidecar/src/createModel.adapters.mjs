/**
 * Internal request/response adapters for OpenAI-compatible hosts.
 * Product callers use createModel.mjs; tests may import this seam directly.
 *
 * Chat Completions and Responses use different request/response shapes.
 * DeepSeek Responses is OpenAI-shaped but uses `reasoning_text` (not
 * `reasoning_summary_text`) and plaintext reasoning `content` (not `summary`).
 */

import { isDeepSeekApiHost } from '@wellread/eve-message';
import {
  captureWebSearchCall,
  injectWebSearchCallsIntoInput,
} from './agent/webSearchReplay.mjs';

/** @typedef {'think' | 'fast'} ThinkingMode */

/**
 * Per-turn fetch store. `thinkingMode` / `onReasoningDelta` are read at
 * fetch start and closed over into the response transform (TransformStream
 * may run after AsyncLocalStorage exits). `reasoningDialect` is mutable:
 * the response transform records which reasoning shape the upstream used,
 * and the next request within the turn reads it back for history replay.
 *
 * @typedef {{
 *   thinkingMode?: ThinkingMode,
 *   onReasoningDelta?: (delta: string) => void,
 *   webSearchCallsToReplay?: Array<{ type: 'web_search_call', id: string, status?: string, action?: unknown }>,
 *   reasoningDialect?: 'deepseek' | 'openai',
 * }} TurnFetchStore
 */

/** Fixed vendor effort when Thinking Mode is Think (no user-facing intensity UI). */
export const THINK_MODE_REASONING_EFFORT = 'high';

/**
 * @param {unknown} value
 * @returns {ThinkingMode}
 */
export function normalizeThinkingMode(value) {
  return value === 'think' ? 'think' : 'fast';
}

/**
 * @param {string | undefined | null} value
 * @returns {'chat' | 'responses'}
 */
export function normalizeApiMode(value) {
  return value === 'responses' ? 'responses' : 'chat';
}

/**
 * Hosts that run `web_search` server-side on the Responses API. Chat
 * Completions and hosts without the tool still get 400 if it is attached,
 * so this gate also requires apiMode === 'responses' (see
 * shouldAttachNativeWebSearch).
 *
 * @param {string | undefined | null} baseURL
 * @returns {boolean}
 */
export function supportsNativeWebSearch(baseURL) {
  return isDeepSeekApiHost(baseURL) || isOpencodeHost(baseURL);
}

/**
 * Canonical key for comparing which host a learned reasoning dialect came
 * from. Dialect is a property of the host, not of the session: after a model
 * switch the next turn must not replay the old host's reasoning shape into a
 * strict gateway that may reject it.
 *
 * @param {string | undefined | null} baseURL
 * @returns {string}
 */
export function normalizeHostKey(baseURL) {
  if (!baseURL || typeof baseURL !== 'string') return '';
  try {
    return new URL(baseURL).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * @param {string | undefined | null} baseURL
 * @returns {boolean}
 */
function isOpencodeHost(baseURL) {
  if (!baseURL || typeof baseURL !== 'string') return false;
  try {
    const host = new URL(baseURL).hostname.toLowerCase();
    return host === 'opencode.ai' || host.endsWith('.opencode.ai');
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   baseURL?: string | null,
 *   apiMode?: string | null,
 * }} input
 * @returns {boolean}
 */
export function shouldAttachNativeWebSearch(input) {
  return (
    supportsNativeWebSearch(input?.baseURL) &&
    normalizeApiMode(input?.apiMode) === 'responses'
  );
}

/**
 * @param {unknown} input
 * @returns {string}
 */
export function requestUrlString(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === 'object' && 'url' in input) {
    const url = /** @type {{ url?: unknown }} */ (input).url;
    if (typeof url === 'string') return url;
  }
  return '';
}

/**
 * @param {string} url
 * @param {Record<string, unknown>} [parsed]
 * @returns {boolean}
 */
export function isResponsesRequest(url, parsed) {
  if (/\/responses(?:\?|$)/.test(url)) return true;
  if (!parsed || typeof parsed !== 'object') return false;
  // Responses bodies use `input`; Chat Completions use `messages`.
  return 'input' in parsed && !('messages' in parsed);
}

/**
 * OpenAI-compatible hosts (DeepSeek, GLM, …):
 * - No proprietary `thinking` field is injected; reasoning models think by
 *   default and the display layer decides whether to show it.
 * - CoT lands on `reasoning_content`; @ai-sdk/openai chat only reads `content`.
 * - Non-gpt* model ids are treated as OpenAI "reasoning" models, so `system` is
 *   rewritten to `role: developer`, which many hosts reject with HTTP 400.
 *
 * Never promote reasoning into content — that made GLM CoT look like the answer.
 * In Think mode, forward reasoning via the turn fetch store callback instead.
 *
 * Responses path: inject `reasoning.effort`, force `store: false`, and adapt
 * Responses reasoning item/event shapes by what the upstream
 * actually emits (see transformResponsesPayload), not by host allowlist.
 *
 * @param {typeof fetch} [baseFetch]
 * @param {{
 *   apiMode?: 'chat' | 'responses',
 * }} [options]
 * @param {{
 *   getStore: () => TurnFetchStore | undefined,
 * }} deps
 * @returns {typeof fetch}
 */
export function withModelFetchPatch(
  baseFetch = globalThis.fetch.bind(globalThis),
  options = {},
  deps,
) {
  if (!deps || typeof deps.getStore !== 'function') {
    throw new Error('withModelFetchPatch requires deps.getStore');
  }
  const configuredApiMode = normalizeApiMode(options.apiMode);
  const { getStore } = deps;
  return async (input, init) => {
    const store = getStore();
    const thinkingMode = normalizeThinkingMode(store?.thinkingMode);
    const onReasoningDelta = store?.onReasoningDelta;
    const webSearchCallsToReplay = store?.webSearchCallsToReplay;
    const reasoningDialect = store?.reasoningDialect;
    let nextInit = init;
    const body = init?.body;
    const url = requestUrlString(input);
    /** @type {Record<string, unknown> | null} */
    let parsedBody = null;
    if (typeof body === 'string' && body.length > 0) {
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsedBody = /** @type {Record<string, unknown>} */ (parsed);
        }
      } catch {
        // Non-JSON body — leave unchanged.
      }
    }
    const useResponses =
      configuredApiMode === 'responses' ||
      isResponsesRequest(url, parsedBody ?? undefined);
    // Record which reasoning shape this upstream speaks. Mutable on the ALS
    // store object so later requests in the turn (tool steps) reuse it; the
    // turn loop persists it onto the session for the next turn.
    const onDialect = (dialect) => {
      if (store && store.reasoningDialect !== dialect) {
        store.reasoningDialect = dialect;
      }
    };
    if (parsedBody) {
      nextInit = {
        ...init,
        body: JSON.stringify(
          useResponses
            ? patchResponsesBody(parsedBody, thinkingMode, {
                reasoningDialect,
                webSearchCallsToReplay,
              })
            : patchChatCompletionBody(parsedBody),
        ),
      };
    }
    const response = await baseFetch(input, nextInit);
    if (useResponses) {
      return transformResponsesModelResponse(response, {
        thinkingMode,
        onReasoningDelta,
        onDialect,
        webSearchCallsToReplay,
      });
    }
    return transformModelResponse(response, { thinkingMode, onReasoningDelta });
  };
}

/**
 * @param {Record<string, unknown>} parsed
 * @returns {Record<string, unknown>}
 */
export function patchChatCompletionBody(parsed) {
  const next = { ...parsed };
  // No proprietary thinking-field injection: reasoning models think by
  // default, and the display layer decides whether to show it. Thinking
  // control fields (thinking/reasoning_effort) are DeepSeek/GLM extensions
  // that plain OpenAI-compatible hosts reject with HTTP 400.
  delete next.thinking;
  delete next.reasoning_effort;
  if (Array.isArray(parsed.messages)) {
    next.messages = parsed.messages.map((message) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return message;
      }
      const row = /** @type {Record<string, unknown>} */ (message);
      if (row.role !== 'developer') return message;
      return { ...row, role: 'system' };
    });
  }
  return next;
}

/**
 * Adapt a Responses request for client-managed history.
 *
 * `reasoning.effort` is a standard Responses API field (OpenAI and DeepSeek
 * both accept it), so it is always sent from Thinking Mode. History
 * reasoning items are rewritten to DeepSeek plaintext only when the
 * upstream is known to speak the DeepSeek dialect (learned from its
 * responses); OpenAI-shaped hosts keep summary + encrypted_content.
 *
 * @param {Record<string, unknown>} parsed
 * @param {ThinkingMode} [thinkingMode]
 * @param {{
 *   reasoningDialect?: 'deepseek' | 'openai',
 *   webSearchCallsToReplay?: Array<{ type: 'web_search_call', id: string, status?: string, action?: unknown }>,
 * }} [options]
 * @returns {Record<string, unknown>}
 */
export function patchResponsesBody(parsed, thinkingMode = 'fast', options = {}) {
  const mode = normalizeThinkingMode(thinkingMode);
  const reasoningDialect = options.reasoningDialect;
  const webSearchCallsToReplay = options.webSearchCallsToReplay;
  const next = { ...parsed };

  // Client owns history; DeepSeek ignores store and item_reference.
  next.store = false;
  delete next.previous_response_id;
  delete next.conversation;

  // Drop Chat Completions-only fields if a mixed client leaked them.
  delete next.thinking;
  delete next.reasoning_effort;
  delete next.messages;

  next.reasoning = {
    effort: mode === 'think' ? THINK_MODE_REASONING_EFFORT : 'none',
  };

  if (Array.isArray(parsed.input)) {
    let input = reasoningDialect === 'deepseek'
      ? parsed.input.map((item) => adaptResponsesInputItem(item))
      : parsed.input;
    if (webSearchCallsToReplay?.length) {
      input = injectWebSearchCallsIntoInput(input, webSearchCallsToReplay);
    }
    next.input = input;
  }

  return next;
}

/**
 * OpenAI SDK sends reasoning as `summary`/`encrypted_content`.
 * DeepSeek expects plaintext `content: [{ type: 'reasoning_text', text }]`.
 *
 * @param {unknown} item
 * @returns {unknown}
 */
export function adaptResponsesInputItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const row = /** @type {Record<string, unknown>} */ (item);
  if (row.type !== 'reasoning') return item;

  const fromContent = extractReasoningText(row.content);
  const fromSummary = extractReasoningText(row.summary);
  const text = fromContent || fromSummary;
  if (!text && !Array.isArray(row.content)) {
    // Keep empty reasoning shells out of the wire when we have nothing useful.
    if (!fromSummary && Array.isArray(row.summary) && row.summary.length === 0) {
      return item;
    }
  }
  const next = {
    type: 'reasoning',
    content: text
      ? [{ type: 'reasoning_text', text }]
      : Array.isArray(row.content)
        ? row.content
        : [],
  };
  if (typeof row.id === 'string' && row.id) {
    return { ...next, id: row.id };
  }
  return next;
}

/**
 * @param {unknown} parts
 * @returns {string}
 */
function extractReasoningText(parts) {
  if (typeof parts === 'string') return parts;
  if (!Array.isArray(parts)) return '';
  /** @type {string[]} */
  const chunks = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (part);
    if (typeof row.text === 'string' && row.text) chunks.push(row.text);
  }
  return chunks.join('');
}

/**
 * Strip provider reasoning from the OpenAI-compatible payload the AI SDK sees,
 * optionally forwarding it to the Reading Assistant turn stream.
 *
 * @param {unknown} payload
 * @param {{
 *   thinkingMode?: ThinkingMode,
 *   onReasoningDelta?: (delta: string) => void,
 * }} [options]
 * @returns {unknown}
 */
export function transformCompletionPayload(payload, options = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const thinkingMode = normalizeThinkingMode(options.thinkingMode);
  const onReasoningDelta = options.onReasoningDelta;
  const record = /** @type {Record<string, unknown>} */ (payload);
  const choices = record.choices;
  if (!Array.isArray(choices)) return payload;

  let changed = false;
  const nextChoices = choices.map((choice) => {
    if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return choice;
    const row = /** @type {Record<string, unknown>} */ (choice);
    let next = row;

    const delta = row.delta;
    if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
      const d = /** @type {Record<string, unknown>} */ (delta);
      const stripped = stripReasoningField(d, { thinkingMode, onReasoningDelta });
      if (stripped !== d) {
        changed = true;
        next = { ...next, delta: stripped };
      }
    }

    const message = row.message;
    if (message && typeof message === 'object' && !Array.isArray(message)) {
      const m = /** @type {Record<string, unknown>} */ (message);
      const stripped = stripReasoningField(m, { thinkingMode, onReasoningDelta });
      if (stripped !== m) {
        changed = true;
        next = { ...next, message: stripped };
      }
    }

    return next;
  });

  return changed ? { ...record, choices: nextChoices } : payload;
}

/**
 * Map Responses payloads to the shape @ai-sdk/openai expects, deciding the
 * dialect from the events/items the upstream actually emits:
 * `response.reasoning_text.*` and plaintext reasoning content are DeepSeek
 * dialect (rewritten to OpenAI summary shape); `reasoning_summary_text.*`
 * and `encrypted_content` items are OpenAI dialect (passed through).
 *
 * @param {unknown} payload
 * @param {{
 *   thinkingMode?: ThinkingMode,
 *   onReasoningDelta?: (delta: string) => void,
 *   onDialect?: (dialect: 'deepseek' | 'openai') => void,
 *   webSearchCallsToReplay?: Array<{ type: 'web_search_call', id: string, status?: string, action?: unknown }>,
 * }} [options]
 * @returns {unknown}
 */
export function transformResponsesPayload(payload, options = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const thinkingMode = normalizeThinkingMode(options.thinkingMode);
  const onReasoningDelta = options.onReasoningDelta;
  const record = /** @type {Record<string, unknown>} */ (payload);

  // Streaming event object (no `output` wrapper).
  if (typeof record.type === 'string' && record.type.startsWith('response.')) {
    return adaptResponsesStreamEvent(record, {
      thinkingMode,
      onReasoningDelta,
      onDialect: options.onDialect,
      webSearchCallsToReplay: options.webSearchCallsToReplay,
    });
  }

  let changed = false;
  /** @type {Record<string, unknown>} */
  let next = record;

  if (Array.isArray(record.output)) {
    const output = record.output.map((item) => {
      captureWebSearchCall(options.webSearchCallsToReplay, item);
      const adapted = adaptResponsesOutputItem(item, options.onDialect);
      if (adapted !== item) changed = true;
      return adapted;
    });
    if (changed) next = { ...next, output };
  }

  if (record.response && typeof record.response === 'object' && !Array.isArray(record.response)) {
    const nested = transformResponsesPayload(record.response, options);
    if (nested !== record.response) {
      changed = true;
      next = { ...next, response: nested };
    }
  }

  return changed ? next : payload;
}

/**
 * @param {Record<string, unknown>} event
 * @param {{
 *   thinkingMode: ThinkingMode,
 *   onReasoningDelta?: (delta: string) => void,
 *   onDialect?: (dialect: 'deepseek' | 'openai') => void,
 *   webSearchCallsToReplay?: Array<{ type: 'web_search_call', id: string, status?: string, action?: unknown }>,
 * }} options
 * @returns {Record<string, unknown>}
 */
function adaptResponsesStreamEvent(event, options) {
  if (event.type === 'response.reasoning_text.delta') {
    options.onDialect?.('deepseek');
    const delta = typeof event.delta === 'string' ? event.delta : '';
    if (delta && options.thinkingMode === 'think' && options.onReasoningDelta) {
      options.onReasoningDelta(delta);
    }
    return {
      ...event,
      type: 'response.reasoning_summary_text.delta',
      summary_index: typeof event.summary_index === 'number' ? event.summary_index : 0,
    };
  }
  if (event.type === 'response.reasoning_text.done') {
    options.onDialect?.('deepseek');
    return {
      ...event,
      type: 'response.reasoning_summary_text.done',
      summary_index: typeof event.summary_index === 'number' ? event.summary_index : 0,
    };
  }
  if (
    event.type === 'response.reasoning_summary_text.delta' ||
    event.type === 'response.reasoning_summary_text.done'
  ) {
    options.onDialect?.('openai');
    return event;
  }
  if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
    captureWebSearchCall(options.webSearchCallsToReplay, event.item);
    const item = adaptResponsesOutputItem(event.item, options.onDialect);
    if (item === event.item) return event;
    return { ...event, item };
  }
  if (event.response && typeof event.response === 'object' && !Array.isArray(event.response)) {
    const response = transformResponsesPayload(event.response, options);
    if (response === event.response) return event;
    return { ...event, response };
  }
  return event;
}

/**
 * DeepSeek → OpenAI-SDK shape for reasoning items.
 * Sets encrypted_content to '' when absent so @ai-sdk/openai's store:false
 * filter keeps the item (it drops reasoning with encrypted_content == null).
 * OpenAI-shaped items (with a real encrypted_content blob) pass through.
 *
 * @param {unknown} item
 * @param {(dialect: 'deepseek' | 'openai') => void} [onDialect]
 * @returns {unknown}
 */
export function adaptResponsesOutputItem(item, onDialect) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const row = /** @type {Record<string, unknown>} */ (item);
  if (row.type !== 'reasoning') return item;

  // OpenAI official shape carries a real encrypted_content blob; keep it.
  if (typeof row.encrypted_content === 'string' && row.encrypted_content) {
    onDialect?.('openai');
    return item;
  }

  const text = extractReasoningText(row.content) || extractReasoningText(row.summary);
  if (!text && !Array.isArray(row.content)) return item;
  onDialect?.('deepseek');
  const summary = Array.isArray(row.summary)
    ? row.summary
    : text
      ? [{ type: 'summary_text', text }]
      : [{ type: 'summary_text', text: '' }];

  return {
    ...row,
    summary,
    // '' (not null/undefined) passes the SDK store:false gate; input adapt
    // later rewrites to DeepSeek plaintext content and drops this placeholder.
    encrypted_content:
      typeof row.encrypted_content === 'string' ? row.encrypted_content : '',
  };
}

/**
 * @param {Record<string, unknown>} part
 * @param {{
 *   thinkingMode: ThinkingMode,
 *   onReasoningDelta?: (delta: string) => void,
 * }} options
 * @returns {Record<string, unknown>}
 */
function stripReasoningField(part, options) {
  const reasoning = part.reasoning_content;
  if (typeof reasoning !== 'string' || reasoning.length === 0) {
    if (!('reasoning_content' in part)) return part;
    const { reasoning_content: _drop, ...rest } = part;
    return rest;
  }

  if (options.thinkingMode === 'think' && options.onReasoningDelta) {
    options.onReasoningDelta(reasoning);
  }

  const { reasoning_content: _drop, ...rest } = part;
  return rest;
}

/**
 * @param {Response} response
 * @param {{
 *   thinkingMode?: ThinkingMode,
 *   onReasoningDelta?: (delta: string) => void,
 * }} [options]
 * @returns {Promise<Response> | Response}
 */
export function transformModelResponse(response, options = {}) {
  return transformSseOrJsonResponse(response, options, transformCompletionPayload);
}

/**
 * @param {Response} response
 * @param {{
 *   thinkingMode?: ThinkingMode,
 *   onReasoningDelta?: (delta: string) => void,
 *   onDialect?: (dialect: 'deepseek' | 'openai') => void,
 * }} [options]
 * @returns {Promise<Response> | Response}
 */
export function transformResponsesModelResponse(response, options = {}) {
  return transformSseOrJsonResponse(response, options, transformResponsesPayload);
}

/**
 * @param {Response} response
 * @param {{
 *   thinkingMode?: ThinkingMode,
 *   onReasoningDelta?: (delta: string) => void,
 *   onDialect?: (dialect: 'deepseek' | 'openai') => void,
 *   webSearchCallsToReplay?: Array<{ type: 'web_search_call', id: string, status?: string, action?: unknown }>,
 * }} options
 * @param {(
 *   payload: unknown,
 *   options: {
 *     thinkingMode?: ThinkingMode,
 *     onReasoningDelta?: (delta: string) => void,
 *     onDialect?: (dialect: 'deepseek' | 'openai') => void,
 *     webSearchCallsToReplay?: Array<{ type: 'web_search_call', id: string, status?: string, action?: unknown }>,
 *   },
 * ) => unknown} transformPayload
 * @returns {Promise<Response> | Response}
 */
function transformSseOrJsonResponse(response, options, transformPayload) {
  const thinkingMode = normalizeThinkingMode(options.thinkingMode);
  const onReasoningDelta = options.onReasoningDelta;
  const payloadOptions = {
    thinkingMode,
    onReasoningDelta,
    onDialect: options.onDialect,
    webSearchCallsToReplay: options.webSearchCallsToReplay,
  };
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream') && response.body) {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';
    const stream = response.body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            controller.enqueue(
              encoder.encode(
                `${rewriteSseDataLine(line, payloadOptions, transformPayload)}\n`,
              ),
            );
          }
        },
        flush(controller) {
          if (buffer.length > 0) {
            controller.enqueue(
              encoder.encode(
                rewriteSseDataLine(buffer, payloadOptions, transformPayload),
              ),
            );
          }
        },
      }),
    );
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  if (contentType.includes('application/json')) {
    return response
      .clone()
      .text()
      .then((text) => {
        try {
          const parsed = JSON.parse(text);
          const transformed = transformPayload(parsed, payloadOptions);
          if (transformed === parsed) return response;
          return new Response(JSON.stringify(transformed), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch {
          return response;
        }
      });
  }

  return response;
}

/**
 * @param {string} line
 * @param {{
 *   thinkingMode: ThinkingMode,
 *   onReasoningDelta?: (delta: string) => void,
 *   onDialect?: (dialect: 'deepseek' | 'openai') => void,
 * }} options
 * @param {(
 *   payload: unknown,
 *   options: {
 *     thinkingMode?: ThinkingMode,
 *     onReasoningDelta?: (delta: string) => void,
 *     onDialect?: (dialect: 'deepseek' | 'openai') => void,
 *   },
 * ) => unknown} [transformPayload]
 * @returns {string}
 */
function rewriteSseDataLine(line, options, transformPayload = transformCompletionPayload) {
  if (!line.startsWith('data:')) return line;
  const raw = line.slice(5).trimStart();
  if (!raw || raw === '[DONE]') return line;
  try {
    const parsed = JSON.parse(raw);
    const transformed = transformPayload(parsed, options);
    if (transformed === parsed) return line;
    return `data: ${JSON.stringify(transformed)}`;
  } catch {
    return line;
  }
}
