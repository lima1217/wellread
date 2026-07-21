import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_CONFIG,
  DEFAULT_PROFILE_NAME,
  addProfile,
  getActiveProfile,
  mergeModelConfig,
  modelApiKeySecureItem,
  normalizeModelApiMode,
  removeProfile,
  renameProfile,
  resetDeepSeekDefaults,
  setActiveProfile,
  shouldHotReloadEve,
  updateProfile,
  type ModelConfig,
  type ModelProfile,
} from '@/services/wellread/modelConfig';

const twoProfiles: ModelConfig = {
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

  it('mergeModelConfig presets DeepSeek when profiles are omitted, keeps explicit empty list', () => {
    const omitted = mergeModelConfig({ enabled: true });
    expect(omitted.profiles).toHaveLength(1);
    expect(omitted.activeProfileId).toBe(omitted.profiles[0]!.id);
    expect(omitted.profiles[0]!.modelId).toBe('deepseek-v4-flash');

    const emptied = mergeModelConfig({ enabled: true, profiles: [], activeProfileId: null });
    expect(emptied.profiles).toEqual([]);
    expect(emptied.activeProfileId).toBeNull();
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
    expect(removeProfile(twoProfiles, 'a')).toEqual({
      enabled: true,
      activeProfileId: 'b',
      profiles: [twoProfiles.profiles[1]],
    });
    expect(removeProfile(twoProfiles, 'a').profiles).toHaveLength(1);
    expect(removeProfile({ ...twoProfiles, profiles: [twoProfiles.profiles[0]!] }, 'a')).toEqual({
      enabled: true,
      activeProfileId: null,
      profiles: [],
    });
    expect(renameProfile(twoProfiles, 'a', 'Alpha').profiles[0]).toMatchObject({
      id: 'a',
      name: 'Alpha',
    });
  });

  it('addProfile appends a DeepSeek-default row with a new id; activates when list was empty', () => {
    const { config, profile } = addProfile(twoProfiles);
    expect(config.profiles).toHaveLength(3);
    expect(profile.id).toBeTruthy();
    expect(profile.id).not.toBe('a');
    expect(profile.id).not.toBe('b');
    expect(profile).toMatchObject({
      name: DEFAULT_PROFILE_NAME,
      baseURL: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      apiMode: 'chat',
    });
    expect(config.activeProfileId).toBe('a');
    expect(config.profiles[2]!.id).toBe(profile.id);

    const fromEmpty = addProfile({ enabled: true, activeProfileId: null, profiles: [] });
    expect(fromEmpty.config.profiles).toHaveLength(1);
    expect(fromEmpty.config.activeProfileId).toBe(fromEmpty.profile.id);
  });

  it('setActiveProfile points at an existing id and no-ops for unknown ids', () => {
    expect(setActiveProfile(twoProfiles, 'b').activeProfileId).toBe('b');
    expect(setActiveProfile(twoProfiles, 'missing')).toBe(twoProfiles);
  });

  it('updateProfile patches fields on a named row without changing id or other rows', () => {
    const next = updateProfile(twoProfiles, 'b', {
      name: 'Work',
      modelId: 'gpt-x',
      baseURL: 'https://work.example/v1',
      contextWindowTokens: 32_000,
      apiMode: 'responses',
    });
    expect(next.profiles[0]).toEqual(twoProfiles.profiles[0]);
    expect(next.profiles[1]).toEqual({
      id: 'b',
      name: 'Work',
      baseURL: 'https://work.example/v1',
      modelId: 'gpt-x',
      contextWindowTokens: 32_000,
      apiMode: 'responses',
    });
    expect(updateProfile(twoProfiles, 'missing', { name: 'Nope' })).toBe(twoProfiles);
  });

  it('shouldHotReloadEve when active pointer changes or the active profile is edited', () => {
    expect(
      shouldHotReloadEve({
        previousActiveId: 'a',
        nextActiveId: 'b',
        editedProfileId: null,
      }),
    ).toBe(true);
    expect(
      shouldHotReloadEve({
        previousActiveId: 'a',
        nextActiveId: 'a',
        editedProfileId: 'a',
      }),
    ).toBe(true);
    expect(
      shouldHotReloadEve({
        previousActiveId: 'a',
        nextActiveId: 'a',
        editedProfileId: 'b',
      }),
    ).toBe(false);
    expect(
      shouldHotReloadEve({
        previousActiveId: 'a',
        nextActiveId: 'a',
        editedProfileId: null,
      }),
    ).toBe(false);
  });
});
