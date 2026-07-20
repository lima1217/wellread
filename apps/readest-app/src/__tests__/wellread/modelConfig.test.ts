import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_CONFIG,
  MODEL_API_KEY_SECURE_ITEM,
  mergeModelConfig,
  resetDeepSeekDefaults,
  type ModelConfig,
} from '@/services/wellread/modelConfig';

describe('ModelConfig', () => {
  it('defaults to DeepSeek v4 flash, disabled, without apiKey', () => {
    expect(DEFAULT_MODEL_CONFIG).toEqual({
      enabled: false,
      baseURL: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
    });
    expect(DEFAULT_MODEL_CONFIG).not.toHaveProperty('apiKey');
    expect(MODEL_API_KEY_SECURE_ITEM).toBe('wellread.model.apiKey');
  });

  it('mergeModelConfig fills missing fields from DeepSeek defaults', () => {
    const merged = mergeModelConfig({ enabled: true, modelId: 'custom-model' });
    expect(merged).toEqual({
      enabled: true,
      baseURL: 'https://api.deepseek.com/v1',
      modelId: 'custom-model',
      contextWindowTokens: 1_000_000,
    });
  });

  it('resetDeepSeekDefaults keeps enabled and leaves apiKey alone', () => {
    const current: ModelConfig = {
      enabled: true,
      baseURL: 'https://example.com/v1',
      modelId: 'other',
      contextWindowTokens: 8_000,
    };
    expect(resetDeepSeekDefaults(current)).toEqual({
      enabled: true,
      baseURL: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
    });
  });

  it('rejects non-positive contextWindowTokens on merge by falling back', () => {
    expect(mergeModelConfig({ contextWindowTokens: 0 }).contextWindowTokens).toBe(1_000_000);
    expect(mergeModelConfig({ contextWindowTokens: -5 }).contextWindowTokens).toBe(1_000_000);
  });
});
