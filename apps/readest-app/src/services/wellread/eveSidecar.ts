import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import type { ModelApiMode } from './modelConfig';

export type EveSidecarInfo = {
  baseUrl: string;
  token: string;
};

/** Flattened active-profile fields for Rust ensure/reload commands. */
export type ReloadEveSidecarPayload = {
  enabled?: boolean;
  baseURL?: string;
  modelId?: string;
  contextWindowTokens?: number;
  apiMode?: ModelApiMode;
  apiKey?: string;
};

export const EVE_SIDECAR_CHANGED_EVENT = 'eve-sidecar-changed';

function toRustModel(payload?: ReloadEveSidecarPayload) {
  if (!payload) return undefined;
  return {
    enabled: payload.enabled,
    baseUrl: payload.baseURL,
    modelId: payload.modelId,
    contextWindowTokens: payload.contextWindowTokens,
    apiMode: payload.apiMode,
    apiKey: payload.apiKey,
  };
}

/** Current eve sidecar listen info, or null when not running. */
export async function getEveSidecarInfo(): Promise<EveSidecarInfo | null> {
  if (!isTauriAppPlatform()) return null;
  try {
    return await invoke<EveSidecarInfo | null>('get_eve_sidecar_info');
  } catch {
    return null;
  }
}

/**
 * Start the sidecar only when needed (dead process or model fingerprint change).
 * Safe to call from every window boot — does not churn PORT when already correct.
 */
export async function ensureEveSidecar(
  payload?: ReloadEveSidecarPayload,
): Promise<EveSidecarInfo | null> {
  if (!isTauriAppPlatform()) return null;
  return invoke<EveSidecarInfo | null>('ensure_eve_sidecar', { model: toRustModel(payload) });
}

/**
 * Force-restart the eve sidecar with the latest active ModelProfile + apiKey
 * (settings / profile switch path).
 */
export async function reloadEveSidecar(
  payload?: ReloadEveSidecarPayload,
): Promise<EveSidecarInfo | null> {
  if (!isTauriAppPlatform()) return null;
  return invoke<EveSidecarInfo | null>('reload_eve_sidecar', { model: toRustModel(payload) });
}

/** Probe GET /eve/v1 with the loopback token. */
export async function probeEveHealth(info: EveSidecarInfo): Promise<boolean> {
  try {
    const res = await fetch(`${info.baseUrl}/eve/v1`, {
      headers: { Authorization: `Bearer ${info.token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
