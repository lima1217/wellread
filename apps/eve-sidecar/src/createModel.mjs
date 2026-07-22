/**
 * Build OpenAI-compatible LanguageModel options for eve defineAgent.
 * Always returns a provider factory call shape — never a bare model string
 * (bare strings force Vercel AI Gateway).
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
 * @param {typeof fetch} [baseFetch]
 * @param {{ injectThinking?: boolean }} [options]
 * @returns {typeof fetch}
 */
export function withModelFetchPatch(
  baseFetch = globalThis.fetch.bind(globalThis),
  options = {},
) {
  const injectThinking = options.injectThinking !== false;
  return async (input, init) => {
    const store = turnFetchContext.getStore();
    const thinkingMode = normalizeThinkingMode(store?.thinkingMode);
    const onReasoningDelta = store?.onReasoningDelta;
    let nextInit = init;
    const body = init?.body;
    if (typeof body === 'string' && body.length > 0) {
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          nextInit = {
            ...init,
            body: JSON.stringify(
              patchChatCompletionBody(parsed, thinkingMode, { injectThinking }),
            ),
          };
        }
      } catch {
        // Non-JSON body — leave unchanged.
      }
    }
    const response = await baseFetch(input, nextInit);
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
      if (!message || typeof message !== 'object' || Array.isArray(message)) return message;
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
  const thinkingMode = normalizeThinkingMode(options.thinkingMode);
  const onReasoningDelta = options.onReasoningDelta;
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
              encoder.encode(`${rewriteSseDataLine(line, { thinkingMode, onReasoningDelta })}\n`),
            );
          }
        },
        flush(controller) {
          if (buffer.length > 0) {
            controller.enqueue(
              encoder.encode(rewriteSseDataLine(buffer, { thinkingMode, onReasoningDelta })),
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
          const transformed = transformCompletionPayload(parsed, {
            thinkingMode,
            onReasoningDelta,
          });
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
 * }} options
 * @returns {string}
 */
function rewriteSseDataLine(line, options) {
  if (!line.startsWith('data:')) return line;
  const raw = line.slice(5).trimStart();
  if (!raw || raw === '[DONE]') return line;
  try {
    const parsed = JSON.parse(raw);
    const transformed = transformCompletionPayload(parsed, options);
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
    }),
  });
  // Default provider(modelId) is Responses API. Most OpenAI-compatible hosts
  // (DeepSeek included) only speak Chat Completions — that is the default.
  const model =
    config.apiMode === 'responses'
      ? provider.responses
        ? provider.responses(config.modelId)
        : provider(config.modelId)
      : provider.chat(config.modelId);
  return {
    model,
    modelContextWindowTokens: config.contextWindowTokens,
  };
}
