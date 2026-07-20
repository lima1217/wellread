/**
 * Build OpenAI-compatible LanguageModel options for eve defineAgent.
 * Always returns a provider factory call shape — never a bare model string
 * (bare strings force Vercel AI Gateway).
 */

export const DEFAULT_MODEL = {
  baseURL: 'https://api.deepseek.com/v1',
  modelId: 'deepseek-v4-flash',
  contextWindowTokens: 1_000_000,
};

/**
 * @param {{ baseURL?: string, apiKey?: string, modelId?: string, contextWindowTokens?: number }} input
 */
export function normalizeModelEnv(input = {}) {
  const baseURL = (input.baseURL || DEFAULT_MODEL.baseURL).replace(/\/+$/, '');
  const modelId = (input.modelId || '').trim() || DEFAULT_MODEL.modelId;
  const apiKey = (input.apiKey || '').trim();
  let contextWindowTokens = Number(input.contextWindowTokens);
  if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
    contextWindowTokens = DEFAULT_MODEL.contextWindowTokens;
  }
  return { baseURL, apiKey, modelId, contextWindowTokens };
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
  });
  const model = provider(config.modelId);
  return {
    model,
    modelContextWindowTokens: config.contextWindowTokens,
  };
}
