/**
 * Build OpenAI-compatible LanguageModel options for eve defineAgent.
 * Always returns a provider factory call shape — never a bare model string
 * (bare strings force Vercel AI Gateway).
 *
 * Chat Completions and Responses use different request/response shapes.
 * DeepSeek Responses is OpenAI-shaped but uses `reasoning_text` (not
 * `reasoning_summary_text`) and plaintext reasoning `content` (not `summary`).
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export const DEFAULT_MODEL = {
  baseURL: 'https://api.deepseek.com/v1',
  modelId: 'deepseek-v4-flash',
  contextWindowTokens: 1_000_000,
  apiMode: /** @type {const} */ ('chat'),
};

/** @typedef {'think' | 'fast'} ThinkingMode */

/** Fixed vendor effort when Thinking Mode is Think (no user-facing intensity UI). */
export const THINK_MODE_REASONING_EFFORT = 'high';

/**
 * Per-turn fetch store. `thinkingMode` / `onReasoningDelta` are read at
 * fetch start and closed over into the response transform (TransformStream
 * may run after AsyncLocalStorage exits).
 * @typedef {{
 *   thinkingMode?: ThinkingMode,
 *   onReasoningDelta?: (delta: string) => void,
 * }} TurnFetchStore
 */

/** @type {AsyncLocalStorage<TurnFetchStore>} */
export const turnFetchContext = new AsyncLocalStorage();

/**
 * @param {unknown} value
 * @returns {ThinkingMode}
 */
export function normalizeThinkingMode(value) {
  return value === 'think' ? 'think' : 'fast';
}

/**
 * DeepSeek / BigModel (GLM) accept the proprietary `thinking` request field.
 * OpenAI official and many other OpenAI-compatible hosts 400 on it
 * ("Unrecognized request argument").
 *
 * @param {string | undefined | null} baseURL
 * @returns {boolean}
 */
export function supportsThinkingExtension(baseURL) {
  if (!baseURL || typeof baseURL !== 'string') return false;
  try {
    const host = new URL(baseURL).hostname.toLowerCase();
    return (
      host === 'api.deepseek.com' ||
      host.endsWith('.deepseek.com') ||
      host === 'open.bigmodel.cn' ||
      host.endsWith('.bigmodel.cn')
    );
  } catch {
    return false;
  }
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
 * - Thinking controlled via `thinking: { type: 'enabled' | 'disabled' }`
 *   **only** on hosts that advertise the extension (see supportsThinkingExtension).
 * - CoT lands on `reasoning_content`; @ai-sdk/openai chat only reads `content`.
 * - Non-gpt* model ids are treated as OpenAI "reasoning" models, so `system` is
 *   rewritten to `role: developer`, which many hosts reject with HTTP 400.
 *
 * Never promote reasoning into content — that made GLM CoT look like the answer.
 * In Think mode, forward reasoning via the turn fetch context callback instead.
 *
 * Responses path: inject `reasoning.effort`, force `store: false`, and adapt
 * DeepSeek reasoning item/event shapes for @ai-sdk/openai.
 *
 * @param {typeof fetch} [baseFetch]
 * @param {{
 *   injectThinking?: boolean,
 *   apiMode?: 'chat' | 'responses',
 * }} [options]
 * @returns {typeof fetch}
 */
export function withModelFetchPatch(
  baseFetch = globalThis.fetch.bind(globalThis),
  options = {},
) {
  const injectThinking = options.injectThinking !== false;
  const configuredApiMode = normalizeApiMode(options.apiMode);
  return async (input, init) => {
    const store = turnFetchContext.getStore();
    const thinkingMode = normalizeThinkingMode(store?.thinkingMode);
    const onReasoningDelta = store?.onReasoningDelta;
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
    // DeepSeek/GLM hosts need reasoning shape adapters; OpenAI must keep
    // summary + encrypted_content for store:false multi-turn continuity.
    const adaptDeepSeekReasoning = injectThinking;
    if (parsedBody) {
      nextInit = {
        ...init,
        body: JSON.stringify(
          useResponses
            ? patchResponsesBody(parsedBody, thinkingMode, {
                injectThinking,
                adaptDeepSeekReasoning,
              })
            : patchChatCompletionBody(parsedBody, thinkingMode, {
                injectThinking,
              }),
        ),
      };
    }
    const response = await baseFetch(input, nextInit);
    if (useResponses) {
      return transformResponsesModelResponse(response, {
        thinkingMode,
        onReasoningDelta,
        adaptDeepSeekReasoning,
      });
    }
    return transformModelResponse(response, { thinkingMode, onReasoningDelta });
  };
}

/** @deprecated Use withModelFetchPatch — kept for older call sites. */
export const withDeepSeekThinkingDisabled = withModelFetchPatch;

/**
 * @param {Record<string, unknown>} parsed
 * @param {ThinkingMode} [thinkingMode]
 * @param {{ injectThinking?: boolean }} [options]
 * @returns {Record<string, unknown>}
 */
export function patchChatCompletionBody(parsed, thinkingMode = 'fast', options = {}) {
  const mode = normalizeThinkingMode(thinkingMode);
  const injectThinking = options.injectThinking !== false;
  const next = { ...parsed };
  if (injectThinking) {
    if (mode === 'think') {
      next.thinking = { type: 'enabled' };
      next.reasoning_effort = THINK_MODE_REASONING_EFFORT;
    } else {
      next.thinking = { type: 'disabled' };
      delete next.reasoning_effort;
    }
  } else {
    delete next.thinking;
    delete next.reasoning_effort;
  }
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

/** @deprecated Use patchChatCompletionBody */
export const patchDeepSeekChatBody = (parsed) => patchChatCompletionBody(parsed, 'fast');

/**
 * Adapt a Responses request for client-managed history.
 * DeepSeek reasoning item rewriting is opt-in via adaptDeepSeekReasoning
 * (tied to supportsThinkingExtension hosts in withModelFetchPatch).
 *
 * @param {Record<string, unknown>} parsed
 * @param {ThinkingMode} [thinkingMode]
 * @param {{
 *   injectThinking?: boolean,
 *   adaptDeepSeekReasoning?: boolean,
 * }} [options]
 * @returns {Record<string, unknown>}
 */
export function patchResponsesBody(parsed, thinkingMode = 'fast', options = {}) {
  const mode = normalizeThinkingMode(thinkingMode);
  const injectThinking = options.injectThinking !== false;
  const adaptDeepSeekReasoning = options.adaptDeepSeekReasoning === true;
  const next = { ...parsed };

  // Client owns history; DeepSeek ignores store and item_reference.
  next.store = false;
  delete next.previous_response_id;
  delete next.conversation;

  // Drop Chat Completions-only fields if a mixed client leaked them.
  delete next.thinking;
  delete next.reasoning_effort;
  delete next.messages;

  if (injectThinking) {
    next.reasoning = {
      effort: mode === 'think' ? THINK_MODE_REASONING_EFFORT : 'none',
    };
  }

  if (adaptDeepSeekReasoning && Array.isArray(parsed.input)) {
    next.input = parsed.input.map((item) => adaptResponsesInputItem(item));
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

/** @deprecated Use transformCompletionPayload — never promotes into content. */
export const promoteReasoningContentInPayload = (payload) =>
  transformCompletionPayload(payload, { thinkingMode: 'fast' });

/**
 * Map DeepSeek Responses payloads to the OpenAI shape @ai-sdk/openai expects.
 *
 * @param {unknown} payload
 * @param {{
 *   thinkingMode?: ThinkingMode,
 *   onReasoningDelta?: (delta: string) => void,
 *   adaptDeepSeekReasoning?: boolean,
 * }} [options]
 * @returns {unknown}
 */
export function transformResponsesPayload(payload, options = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const thinkingMode = normalizeThinkingMode(options.thinkingMode);
  const onReasoningDelta = options.onReasoningDelta;
  const adaptDeepSeekReasoning = options.adaptDeepSeekReasoning === true;
  const record = /** @type {Record<string, unknown>} */ (payload);

  // Streaming event object (no `output` wrapper).
  if (typeof record.type === 'string' && record.type.startsWith('response.')) {
    return adaptResponsesStreamEvent(record, {
      thinkingMode,
      onReasoningDelta,
      adaptDeepSeekReasoning,
    });
  }

  let changed = false;
  /** @type {Record<string, unknown>} */
  let next = record;

  if (adaptDeepSeekReasoning && Array.isArray(record.output)) {
    const output = record.output.map((item) => {
      const adapted = adaptResponsesOutputItem(item);
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
 *   adaptDeepSeekReasoning?: boolean,
 * }} options
 * @returns {Record<string, unknown>}
 */
function adaptResponsesStreamEvent(event, options) {
  if (!options.adaptDeepSeekReasoning) return event;
  if (event.type === 'response.reasoning_text.delta') {
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
    return {
      ...event,
      type: 'response.reasoning_summary_text.done',
      summary_index: typeof event.summary_index === 'number' ? event.summary_index : 0,
    };
  }
  if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
    const item = adaptResponsesOutputItem(event.item);
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
 *
 * @param {unknown} item
 * @returns {unknown}
 */
export function adaptResponsesOutputItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const row = /** @type {Record<string, unknown>} */ (item);
  if (row.type !== 'reasoning') return item;

  const text = extractReasoningText(row.content) || extractReasoningText(row.summary);
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
 *   adaptDeepSeekReasoning?: boolean,
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
 *   adaptDeepSeekReasoning?: boolean,
 * }} options
 * @param {(
 *   payload: unknown,
 *   options: {
 *     thinkingMode?: ThinkingMode,
 *     onReasoningDelta?: (delta: string) => void,
 *     adaptDeepSeekReasoning?: boolean,
 *   },
 * ) => unknown} transformPayload
 * @returns {Promise<Response> | Response}
 */
function transformSseOrJsonResponse(response, options, transformPayload) {
  const thinkingMode = normalizeThinkingMode(options.thinkingMode);
  const onReasoningDelta = options.onReasoningDelta;
  const adaptDeepSeekReasoning = options.adaptDeepSeekReasoning === true;
  const payloadOptions = { thinkingMode, onReasoningDelta, adaptDeepSeekReasoning };
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

/** @deprecated Use transformModelResponse */
export const promoteReasoningContentInResponse = (response) =>
  transformModelResponse(response, { thinkingMode: 'fast' });

/**
 * @param {string} line
 * @param {{
 *   thinkingMode: ThinkingMode,
 *   onReasoningDelta?: (delta: string) => void,
 *   adaptDeepSeekReasoning?: boolean,
 * }} options
 * @param {(
 *   payload: unknown,
 *   options: {
 *     thinkingMode?: ThinkingMode,
 *     onReasoningDelta?: (delta: string) => void,
 *     adaptDeepSeekReasoning?: boolean,
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

/**
 * @param {string | undefined | null} value
 * @returns {'chat' | 'responses'}
 */
export function normalizeApiMode(value) {
  return value === 'responses' ? 'responses' : 'chat';
}

/**
 * @param {{
 *   baseURL?: string,
 *   apiKey?: string,
 *   modelId?: string,
 *   contextWindowTokens?: number,
 *   apiMode?: string,
 * }} input
 */
export function normalizeModelEnv(input = {}) {
  const baseURL = (input.baseURL || DEFAULT_MODEL.baseURL).replace(/\/+$/, '');
  const modelId = (input.modelId || '').trim() || DEFAULT_MODEL.modelId;
  const apiKey = (input.apiKey || '').trim();
  let contextWindowTokens = Number(input.contextWindowTokens);
  if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
    contextWindowTokens = DEFAULT_MODEL.contextWindowTokens;
  }
  const apiMode = normalizeApiMode(input.apiMode);
  return { baseURL, apiKey, modelId, contextWindowTokens, apiMode };
}

/**
 * Construct an AI SDK LanguageModel instance (not a string).
 * @param {ReturnType<typeof normalizeModelEnv>} config
 * @param {{
 *   createOpenAI?: typeof import('@ai-sdk/openai').createOpenAI,
 *   baseFetch?: typeof fetch,
 * }} [deps]
 */
export function createLanguageModel(config, deps = {}) {
  const createOpenAI = deps.createOpenAI;
  if (typeof createOpenAI !== 'function') {
    throw new Error('createOpenAI dependency required');
  }
  const provider = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey || 'missing-key',
    fetch: withModelFetchPatch(deps.baseFetch, {
      injectThinking: supportsThinkingExtension(config.baseURL),
      apiMode: config.apiMode,
    }),
  });
  // Default provider(modelId) is Responses API. Chat Completions remains the
  // default apiMode for broad OpenAI-compatible host support.
  const model =
    config.apiMode === 'responses'
      ? provider.responses
        ? provider.responses(config.modelId)
        : provider(config.modelId)
      : provider.chat(config.modelId);
  return {
    model,
    modelContextWindowTokens: config.contextWindowTokens,
    apiMode: config.apiMode,
  };
}
