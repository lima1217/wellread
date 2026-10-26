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
  const apiMode =
    input.apiMode === undefined || input.apiMode === null || input.apiMode === ''
      ? DEFAULT_MODEL.apiMode
      : normalizeApiMode(input.apiMode);
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
 * `instructions` is the stable per-book system prompt. The per-turn
 * `<reading_context>` envelope rides the user message instead, so the system
 * prefix (and every prior turn) stays byte-identical for provider prompt
 * caching.
 *
 * @param {{
 *   apiMode?: string,
 *   thinkingMode?: ThinkingMode,
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
      // Base prompt already rides the Responses `instructions` field; the
      // exhaustion step only adds its own note as a top-level system message.
      toolSystem: '',
      streamTextOptions: {
        // Top-level reasoning maps to provider effort (@ai-sdk/openai).
        reasoning:
          thinkingMode === 'think' ? THINK_MODE_REASONING_EFFORT : 'none',
        providerOptions: {
          openai: {
            store: false,
            instructions: input.instructions,
          },
        },
      },
    };
  }
  return {
    toolSystem: input.instructions,
    streamTextOptions: { instructions: input.instructions },
  };
}
