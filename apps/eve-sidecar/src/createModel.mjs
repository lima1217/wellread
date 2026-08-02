/**
 * Deep facade for Reading Assistant model wiring.
 *
 * Product callers (server / runTurn) should only need:
 *   normalizeModelEnv, createLanguageModel, normalizeThinkingMode,
 *   turnFetchContext, bindTurnFetchPatch, resolveTurnModelPresentation.
 *
 * Host-specific patch/transform lives in createModel.adapters.mjs.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  normalizeApiMode,
  normalizeThinkingMode,
  supportsThinkingExtension,
  THINK_MODE_REASONING_EFFORT,
  withModelFetchPatch,
} from './createModel.adapters.mjs';

export { normalizeThinkingMode };

/** @typedef {import('./createModel.adapters.mjs').ThinkingMode} ThinkingMode */
/** @typedef {import('./createModel.adapters.mjs').TurnFetchStore} TurnFetchStore */

const DEFAULT_MODEL = {
  baseURL: 'https://api.deepseek.com/v1',
  modelId: 'deepseek-v4-flash',
  contextWindowTokens: 1_000_000,
  apiMode: /** @type {const} */ ('chat'),
};

/** @type {AsyncLocalStorage<TurnFetchStore>} */
export const turnFetchContext = new AsyncLocalStorage();

/**
 * Bind host fetch adapters to the public per-turn ALS.
 *
 * @param {typeof fetch} [baseFetch]
 * @param {{
 *   injectThinking?: boolean,
 *   apiMode?: 'chat' | 'responses',
 * }} [options]
 * @returns {typeof fetch}
 */
export function bindTurnFetchPatch(baseFetch, options = {}) {
  return withModelFetchPatch(baseFetch, options, {
    getStore: () => turnFetchContext.getStore(),
  });
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
    fetch: bindTurnFetchPatch(deps.baseFetch, {
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

/**
 * Hide chat vs Responses streamText / tool-step system wiring from the turn loop.
 *
 * @param {{
 *   apiMode?: string,
 *   thinkingMode?: ThinkingMode,
 *   system: string,
 *   envelope: string,
 *   instructions: string,
 * }} input
 * @returns {{
 *   toolSystem: string,
 *   streamTextOptions: Record<string, unknown>,
 * }}
 */
export function resolveTurnModelPresentation(input) {
  const apiMode = normalizeApiMode(input.apiMode);
  const thinkingMode = normalizeThinkingMode(input.thinkingMode);
  if (apiMode === 'responses') {
    return {
      toolSystem: input.envelope || '',
      streamTextOptions: {
        // Envelope stays as top-level instructions; book base prompt rides
        // providerOptions.openai.instructions (Responses API field).
        instructions: input.envelope || undefined,
        providerOptions: {
          openai: {
            store: false,
            instructions: input.instructions,
            reasoningEffort:
              thinkingMode === 'think' ? THINK_MODE_REASONING_EFFORT : 'none',
          },
        },
      },
    };
  }
  return {
    toolSystem: input.system,
    streamTextOptions: { instructions: input.system },
  };
}
