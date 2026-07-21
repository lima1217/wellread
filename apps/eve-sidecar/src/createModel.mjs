/**
 * Build OpenAI-compatible LanguageModel options for eve defineAgent.
 * Always returns a provider factory call shape — never a bare model string
 * (bare strings force Vercel AI Gateway).
 */

export const DEFAULT_MODEL = {
  baseURL: 'https://api.deepseek.com/v1',
  modelId: 'deepseek-v4-flash',
  contextWindowTokens: 1_000_000,
  apiMode: /** @type {const} */ ('chat'),
};

/**
 * DeepSeek V4 + @ai-sdk/openai quirks:
 * - Thinking defaults on; CoT lands on `reasoning_content` (SDK only reads `content`).
 * - Non-gpt* model ids are treated as OpenAI "reasoning" models, so `system` is
 *   rewritten to `role: developer`, which DeepSeek rejects with HTTP 400 — and
 *   streamText then surfaces as an empty reply.
 * Always force non-thinking and rewrite developer → system on the wire.
 *
 * @param {typeof fetch} [baseFetch]
 * @returns {typeof fetch}
 */
export function withDeepSeekThinkingDisabled(baseFetch = globalThis.fetch.bind(globalThis)) {
  return async (input, init) => {
    let nextInit = init;
    const body = init?.body;
    if (typeof body === 'string' && body.length > 0) {
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          nextInit = {
            ...init,
            body: JSON.stringify(patchDeepSeekChatBody(parsed)),
          };
        }
      } catch {
        // Non-JSON body — leave unchanged.
      }
    }
    const response = await baseFetch(input, nextInit);
    return promoteReasoningContentInResponse(response);
  };
}

/**
 * @param {Record<string, unknown>} parsed
 * @returns {Record<string, unknown>}
 */
export function patchDeepSeekChatBody(parsed) {
  const next = { ...parsed, thinking: { type: 'disabled' } };
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

/**
 * When a host still emits reasoning_content with empty content (ignored
 * thinking flag, proxy quirks), copy reasoning into content so the AI SDK
 * textStream is not empty.
 *
 * @param {unknown} payload
 * @returns {unknown}
 */
export function promoteReasoningContentInPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
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
      const promoted = promoteEmptyContent(d);
      if (promoted !== d) {
        changed = true;
        next = { ...next, delta: promoted };
      }
    }

    const message = row.message;
    if (message && typeof message === 'object' && !Array.isArray(message)) {
      const m = /** @type {Record<string, unknown>} */ (message);
      const promoted = promoteEmptyContent(m);
      if (promoted !== m) {
        changed = true;
        next = { ...next, message: promoted };
      }
    }

    return next;
  });

  return changed ? { ...record, choices: nextChoices } : payload;
}

/**
 * @param {Record<string, unknown>} part
 * @returns {Record<string, unknown>}
 */
function promoteEmptyContent(part) {
  const content = part.content;
  const reasoning = part.reasoning_content;
  const contentEmpty = content == null || content === '';
  if (contentEmpty && typeof reasoning === 'string' && reasoning.length > 0) {
    return { ...part, content: reasoning };
  }
  return part;
}

/**
 * @param {Response} response
 * @returns {Promise<Response> | Response}
 */
export function promoteReasoningContentInResponse(response) {
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
            controller.enqueue(encoder.encode(`${rewriteSseDataLine(line)}\n`));
          }
        },
        flush(controller) {
          if (buffer.length > 0) {
            controller.enqueue(encoder.encode(rewriteSseDataLine(buffer)));
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
          const promoted = promoteReasoningContentInPayload(parsed);
          if (promoted === parsed) return response;
          return new Response(JSON.stringify(promoted), {
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
 * @returns {string}
 */
function rewriteSseDataLine(line) {
  if (!line.startsWith('data:')) return line;
  const raw = line.slice(5).trimStart();
  if (!raw || raw === '[DONE]') return line;
  try {
    const parsed = JSON.parse(raw);
    const promoted = promoteReasoningContentInPayload(parsed);
    if (promoted === parsed) return line;
    return `data: ${JSON.stringify(promoted)}`;
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
 * @param {{ createOpenAI?: typeof import('@ai-sdk/openai').createOpenAI }} [deps]
 */
export function createLanguageModel(config, deps = {}) {
  const createOpenAI = deps.createOpenAI;
  if (typeof createOpenAI !== 'function') {
    throw new Error('createOpenAI dependency required');
  }
  const provider = createOpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey || 'missing-key',
    fetch: withDeepSeekThinkingDisabled(),
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
