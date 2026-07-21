/**
 * ModelConfig — multi ModelProfile BYO settings (ai-panel SPEC §3 / tickets 01–02).
 * apiKey lives in OS keychain per profile id, never on these types.
 */

import { v4 as uuidv4 } from 'uuid';

/** Which OpenAI-style endpoint family the sidecar should call. */
export type ModelApiMode = 'chat' | 'responses';

export type ModelProfile = {
  id: string;
  name: string;
  baseURL: string;
  modelId: string;
  contextWindowTokens: number;
  /**
   * `chat` → Chat Completions (`provider.chat`, /v1/chat/completions).
   * `responses` → OpenAI Responses API (`provider.responses`, /v1/responses).
   * Default `chat` — required for DeepSeek and most OpenAI-compatible hosts.
   */
  apiMode: ModelApiMode;
};

/** Global model settings container (not a single endpoint row). */
export type ModelConfig = {
  enabled: boolean;
  activeProfileId: string | null;
  profiles: ModelProfile[];
};

/** Legacy single-slot keychain item before per-profile slots. */
export const LEGACY_MODEL_API_KEY_SECURE_ITEM = 'wellread.model.apiKey';

export const DEFAULT_PROFILE_NAME = 'DeepSeek';

export const DEFAULT_PROFILE_ID = 'deepseek-default';

const DEFAULT_PROFILE_FIELDS = {
  name: DEFAULT_PROFILE_NAME,
  baseURL: 'https://api.deepseek.com/v1',
  modelId: 'deepseek-v4-flash',
  contextWindowTokens: 1_000_000,
  apiMode: 'chat' as ModelApiMode,
};

export function modelApiKeySecureItem(profileId: string): string {
  return `wellread.model.apiKey.${profileId}`;
}

export function createDefaultProfile(id: string = DEFAULT_PROFILE_ID): ModelProfile {
  return { id, ...DEFAULT_PROFILE_FIELDS };
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  enabled: false,
  activeProfileId: DEFAULT_PROFILE_ID,
  profiles: [createDefaultProfile()],
};

export function normalizeModelApiMode(value?: string | null): ModelApiMode {
  return value === 'responses' ? 'responses' : 'chat';
}

type LegacyModelConfig = {
  enabled?: boolean;
  baseURL?: string;
  modelId?: string;
  contextWindowTokens?: number;
  apiMode?: string;
};

function isLegacySingleTrack(value: unknown): value is LegacyModelConfig {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return !('profiles' in record) && ('baseURL' in record || 'modelId' in record);
}

function normalizeContextWindowTokens(value: unknown): number {
  return typeof value === 'number' && value > 0
    ? value
    : DEFAULT_PROFILE_FIELDS.contextWindowTokens;
}

function normalizeProfile(
  partial: Partial<ModelProfile> & { id: string },
  fallbackName = DEFAULT_PROFILE_NAME,
): ModelProfile {
  return {
    id: partial.id,
    name: partial.name?.trim() || fallbackName,
    baseURL: partial.baseURL?.trim() || DEFAULT_PROFILE_FIELDS.baseURL,
    modelId: partial.modelId?.trim() || DEFAULT_PROFILE_FIELDS.modelId,
    contextWindowTokens: normalizeContextWindowTokens(partial.contextWindowTokens),
    apiMode: normalizeModelApiMode(partial.apiMode),
  };
}

function migrateLegacy(legacy: LegacyModelConfig): ModelConfig {
  const profile = normalizeProfile({
    id: DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME,
    baseURL: legacy.baseURL,
    modelId: legacy.modelId,
    contextWindowTokens: legacy.contextWindowTokens,
    apiMode: normalizeModelApiMode(legacy.apiMode),
  });
  return {
    enabled: legacy.enabled ?? DEFAULT_MODEL_CONFIG.enabled,
    activeProfileId: profile.id,
    profiles: [profile],
  };
}

/** Resolve the active profile row, or null when the pointer is missing/invalid. */
export function getActiveProfile(config: ModelConfig): ModelProfile | null {
  const id = config.activeProfileId;
  if (!id) return null;
  return config.profiles.find((p) => p.id === id) ?? null;
}

/**
 * Flatten active profile + global enabled for sidecar reload payloads.
 * Returns null when there is no valid active profile.
 */
export function toSidecarModelPayload(config: ModelConfig): {
  enabled: boolean;
  baseURL: string;
  modelId: string;
  contextWindowTokens: number;
  apiMode: ModelApiMode;
} | null {
  const profile = getActiveProfile(config);
  if (!profile) return null;
  return {
    enabled: config.enabled,
    baseURL: profile.baseURL,
    modelId: profile.modelId,
    contextWindowTokens: profile.contextWindowTokens,
    apiMode: profile.apiMode,
  };
}

/**
 * Merge persisted settings into a valid ModelConfig.
 * Migrates legacy single-track `{ enabled, baseURL, modelId, … }` into one profile.
 */
export function mergeModelConfig(partial?: Partial<ModelConfig> | null): ModelConfig {
  if (isLegacySingleTrack(partial)) {
    return migrateLegacy(partial);
  }

  const enabled = partial?.enabled ?? DEFAULT_MODEL_CONFIG.enabled;
  // Omitted `profiles` → preset DeepSeek default. Explicit `[]` stays empty
  // so settings can show the post-delete-all empty state (ticket 02).
  const rawProfiles = Array.isArray(partial?.profiles) ? partial.profiles : null;
  const profiles =
    rawProfiles === null
      ? [createDefaultProfile()]
      : rawProfiles
          .filter((p): p is ModelProfile => Boolean(p && typeof p.id === 'string' && p.id))
          .map((p) => normalizeProfile(p));

  let activeProfileId = partial?.activeProfileId ?? null;
  if (profiles.length === 0) {
    activeProfileId = null;
  } else if (!activeProfileId || !profiles.some((p) => p.id === activeProfileId)) {
    activeProfileId = profiles[0]!.id;
  }

  return { enabled, activeProfileId, profiles };
}

/** Reset active profile endpoint fields to DeepSeek defaults; keep enabled / id / name. */
export function resetDeepSeekDefaults(current: ModelConfig): ModelConfig {
  const activeId = current.activeProfileId;
  return {
    enabled: current.enabled,
    activeProfileId: activeId,
    profiles: current.profiles.map((profile) =>
      profile.id === activeId
        ? {
            ...profile,
            baseURL: DEFAULT_PROFILE_FIELDS.baseURL,
            modelId: DEFAULT_PROFILE_FIELDS.modelId,
            contextWindowTokens: DEFAULT_PROFILE_FIELDS.contextWindowTokens,
            apiMode: DEFAULT_PROFILE_FIELDS.apiMode,
          }
        : profile,
    ),
  };
}

/**
 * Remove a profile row. If it was active, activates another remaining profile
 * (or null when the list is empty). Does not touch keychain — call clearModelApiKey.
 */
export function removeProfile(config: ModelConfig, profileId: string): ModelConfig {
  const profiles = config.profiles.filter((p) => p.id !== profileId);
  if (profiles.length === 0) {
    return { enabled: config.enabled, activeProfileId: null, profiles: [] };
  }
  const activeStillValid =
    config.activeProfileId !== null &&
    config.activeProfileId !== profileId &&
    profiles.some((p) => p.id === config.activeProfileId);
  return {
    enabled: config.enabled,
    activeProfileId: activeStillValid ? config.activeProfileId : profiles[0]!.id,
    profiles,
  };
}

/** Rename a profile's display name only — id (and keychain slot) stay stable. */
export function renameProfile(config: ModelConfig, profileId: string, name: string): ModelConfig {
  const trimmed = name.trim();
  if (!trimmed) return config;
  return {
    ...config,
    profiles: config.profiles.map((p) => (p.id === profileId ? { ...p, name: trimmed } : p)),
  };
}

/** Append a DeepSeek-default profile. Activates it when the list was empty. */
export function addProfile(config: ModelConfig): { config: ModelConfig; profile: ModelProfile } {
  const profile = createDefaultProfile(uuidv4());
  const profiles = [...config.profiles, profile];
  const activeProfileId = config.profiles.length === 0 ? profile.id : config.activeProfileId;
  return {
    profile,
    config: { enabled: config.enabled, activeProfileId, profiles },
  };
}

/** Point `activeProfileId` at an existing profile; unknown ids are a no-op. */
export function setActiveProfile(config: ModelConfig, profileId: string): ModelConfig {
  if (!config.profiles.some((p) => p.id === profileId)) return config;
  if (config.activeProfileId === profileId) return config;
  return { ...config, activeProfileId: profileId };
}

/** Patch fields on a named profile; unknown ids are a no-op. Id stays stable. */
export function updateProfile(
  config: ModelConfig,
  profileId: string,
  fields: Partial<Omit<ModelProfile, 'id'>>,
): ModelConfig {
  if (!config.profiles.some((p) => p.id === profileId)) return config;
  return {
    ...config,
    profiles: config.profiles.map((p) =>
      p.id === profileId ? normalizeProfile({ ...p, ...fields, id: p.id }) : p,
    ),
  };
}

/**
 * Whether saving should restart eve with the active profile.
 * Active pointer change, or edits to the active row → reload; non-active edits do not.
 */
export function shouldHotReloadEve(input: {
  previousActiveId: string | null;
  nextActiveId: string | null;
  editedProfileId: string | null;
}): boolean {
  if (input.previousActiveId !== input.nextActiveId) return true;
  if (input.editedProfileId && input.editedProfileId === input.nextActiveId) return true;
  return false;
}
