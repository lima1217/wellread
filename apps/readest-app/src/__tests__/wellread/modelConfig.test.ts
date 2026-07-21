import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_CONFIG,
  DEFAULT_PROFILE_NAME,
  getActiveProfile,
  mergeModelConfig,
  modelApiKeySecureItem,
  normalizeModelApiMode,
  removeProfile,
  renameProfile,
  resetDeepSeekDefaults,
  type ModelConfig,
  type ModelProfile,
} from '@/services/wellread/modelConfig';

describe('ModelConfig (multi ModelProfile)', () => {
  it('defaults to one DeepSeek profile, disabled, with no apiKey on the profile', () => {
    expect(DEFAULT_MODEL_CONFIG.enabled).toBe(false);
    expect(DEFAULT_MODEL_CONFIG.profiles).toHaveLength(1);
    expect(DEFAULT_MODEL_CONFIG.activeProfileId).toBe(DEFAULT_MODEL_CONFIG.profiles[0]!.id);
    expect(DEFAULT_MODEL_CONFIG.profiles[0]).toMatchObject({
      name: DEFAULT_PROFILE_NAME,
      baseURL: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      apiMode: 'chat',
    });
    expect(DEFAULT_MODEL_CONFIG.profiles[0]).not.toHaveProperty('apiKey');
    expect(DEFAULT_MODEL_CONFIG).not.toHaveProperty('apiKey');
    expect(DEFAULT_MODEL_CONFIG).not.toHaveProperty('baseURL');
  });

  it('modelApiKeySecureItem scopes the keychain slot by profile id', () => {
    expect(modelApiKeySecureItem('abc')).toBe('wellread.model.apiKey.abc');
  });

  it('mergeModelConfig migrates a legacy single-track object into one named profile', () => {
    const merged = mergeModelConfig({
      enabled: true,
      baseURL: 'https://api.example.com/v1',
      modelId: 'custom-model',
      contextWindowTokens: 64_000,
      apiMode: 'responses',
    } as unknown as Partial<ModelConfig>);

    expect(merged.enabled).toBe(true);
    expect(merged.profiles).toHaveLength(1);
    expect(merged.activeProfileId).toBe(merged.profiles[0]!.id);
    expect(merged.profiles[0]).toMatchObject({
      name: DEFAULT_PROFILE_NAME,
      baseURL: 'https://api.example.com/v1',
      modelId: 'custom-model',
      contextWindowTokens: 64_000,
      apiMode: 'responses',
    });
    expect(merged.profiles[0]!.id).toBeTruthy();
    expect(merged).not.toHaveProperty('baseURL');
    expect(merged).not.toHaveProperty('modelId');
  });

  it('mergeModelConfig fills missing multi-profile fields from DeepSeek defaults', () => {
    const merged = mergeModelConfig({
      enabled: true,
      profiles: [
        {
          id: 'p1',
          name: 'Work',
          modelId: 'custom-model',
        } as ModelProfile,
      ],
      activeProfileId: 'p1',
    });

    expect(merged).toEqual({
      enabled: true,
      activeProfileId: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'Work',
          baseURL: 'https://api.deepseek.com/v1',
          modelId: 'custom-model',
          contextWindowTokens: 1_000_000,
          apiMode: 'chat',
        },
      ],
    });
  });

  it('mergeModelConfig presets a DeepSeek profile when profiles is empty', () => {
    const merged = mergeModelConfig({ enabled: true, profiles: [], activeProfileId: null });
    expect(merged.profiles).toHaveLength(1);
    expect(merged.activeProfileId).toBe(merged.profiles[0]!.id);
    expect(merged.profiles[0]!.modelId).toBe('deepseek-v4-flash');
  });

  it('getActiveProfile returns the active row or null when missing', () => {
    const config = mergeModelConfig({
      enabled: true,
      profiles: [
        {
          id: 'a',
          name: 'A',
          baseURL: 'https://a.example/v1',
          modelId: 'm-a',
          contextWindowTokens: 1000,
          apiMode: 'chat',
        },
        {
          id: 'b',
          name: 'B',
          baseURL: 'https://b.example/v1',
          modelId: 'm-b',
          contextWindowTokens: 2000,
          apiMode: 'chat',
        },
      ],
      activeProfileId: 'b',
    });
    expect(getActiveProfile(config)?.id).toBe('b');
    expect(getActiveProfile({ ...config, activeProfileId: 'missing' })).toBeNull();
    expect(getActiveProfile({ ...config, activeProfileId: null })).toBeNull();
  });

  it('normalizeModelApiMode rejects unknown values', () => {
    expect(normalizeModelApiMode('responses')).toBe('responses');
    expect(normalizeModelApiMode('chat')).toBe('chat');
    expect(normalizeModelApiMode('other')).toBe('chat');
    expect(normalizeModelApiMode(undefined)).toBe('chat');
  });

  it('resetDeepSeekDefaults keeps enabled and active id, resets the active profile endpoints', () => {
    const current: ModelConfig = {
      enabled: true,
      activeProfileId: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'Custom',
          baseURL: 'https://example.com/v1',
          modelId: 'other',
          contextWindowTokens: 8_000,
          apiMode: 'responses',
        },
      ],
    };
    expect(resetDeepSeekDefaults(current)).toEqual({
      enabled: true,
      activeProfileId: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'Custom',
          baseURL: 'https://api.deepseek.com/v1',
          modelId: 'deepseek-v4-flash',
          contextWindowTokens: 1_000_000,
          apiMode: 'chat',
        },
      ],
    });
  });

  it('rejects non-positive contextWindowTokens on merge by falling back', () => {
    const merged = mergeModelConfig({
      profiles: [
        {
          id: 'p1',
          name: 'A',
          baseURL: 'https://api.deepseek.com/v1',
          modelId: 'm',
          contextWindowTokens: 0,
          apiMode: 'chat',
        },
      ],
      activeProfileId: 'p1',
    });
    expect(merged.profiles[0]!.contextWindowTokens).toBe(1_000_000);
  });

  it('removeProfile clears the row and reassigns active; rename keeps id', () => {
    const config: ModelConfig = {
      enabled: true,
      activeProfileId: 'a',
      profiles: [
        {
          id: 'a',
          name: 'A',
          baseURL: 'https://a.example/v1',
          modelId: 'm-a',
          contextWindowTokens: 1000,
          apiMode: 'chat',
        },
        {
          id: 'b',
          name: 'B',
          baseURL: 'https://b.example/v1',
          modelId: 'm-b',
          contextWindowTokens: 2000,
          apiMode: 'chat',
        },
      ],
    };
    expect(removeProfile(config, 'a')).toEqual({
      enabled: true,
      activeProfileId: 'b',
      profiles: [config.profiles[1]],
    });
    expect(removeProfile(config, 'a').profiles).toHaveLength(1);
    expect(removeProfile({ ...config, profiles: [config.profiles[0]!] }, 'a')).toEqual({
      enabled: true,
      activeProfileId: null,
      profiles: [],
    });
    expect(renameProfile(config, 'a', 'Alpha').profiles[0]).toMatchObject({
      id: 'a',
      name: 'Alpha',
    });
  });
});
