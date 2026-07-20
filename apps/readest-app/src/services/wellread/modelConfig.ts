/**
 * ModelConfig — BYO OpenAI-compatible cloud settings (ticket 07 / issue #6).
 * apiKey lives in OS keychain under MODEL_API_KEY_SECURE_ITEM, never here.
 */

export type ModelConfig = {
  enabled: boolean;
  baseURL: string;
  modelId: string;
  contextWindowTokens: number;
};

export const MODEL_API_KEY_SECURE_ITEM = 'wellread.model.apiKey';

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  enabled: false,
  baseURL: 'https://api.deepseek.com/v1',
  modelId: 'deepseek-v4-flash',
  contextWindowTokens: 1_000_000,
};

export function mergeModelConfig(partial?: Partial<ModelConfig> | null): ModelConfig {
  const contextWindowTokens =
    typeof partial?.contextWindowTokens === 'number' && partial.contextWindowTokens > 0
      ? partial.contextWindowTokens
      : DEFAULT_MODEL_CONFIG.contextWindowTokens;

  return {
    enabled: partial?.enabled ?? DEFAULT_MODEL_CONFIG.enabled,
    baseURL: partial?.baseURL?.trim() || DEFAULT_MODEL_CONFIG.baseURL,
    modelId: partial?.modelId?.trim() || DEFAULT_MODEL_CONFIG.modelId,
    contextWindowTokens,
  };
}

/** Reset endpoint fields to DeepSeek defaults; keep `enabled` as-is. */
export function resetDeepSeekDefaults(current: ModelConfig): ModelConfig {
  return {
    enabled: current.enabled,
    baseURL: DEFAULT_MODEL_CONFIG.baseURL,
    modelId: DEFAULT_MODEL_CONFIG.modelId,
    contextWindowTokens: DEFAULT_MODEL_CONFIG.contextWindowTokens,
  };
}
