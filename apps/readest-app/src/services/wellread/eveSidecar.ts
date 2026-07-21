import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import type { ModelApiMode } from './modelConfig';

export type EveSidecarInfo = {
  baseUrl: string;
  token: string;
};

/** Flattened active-profile fields for Rust reload_eve_sidecar. */
export type ReloadEveSidecarPayload = {
  enabled?: boolean;
  baseURL?: string;
  modelId?: string;
  contextWindowTokens?: number;
  apiMode?: ModelApiMode;
  apiKey?: string;
};

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
 * Ask Rust to restart the eve sidecar with the latest active ModelProfile + apiKey
 * (hot-reload degradation path from ticket 07).
 */
export async function reloadEveSidecar(
  payload?: ReloadEveSidecarPayload,
): Promise<EveSidecarInfo | null> {
  if (!isTauriAppPlatform()) return null;
  const model = payload
    ? {
        enabled: payload.enabled,
        baseUrl: payload.baseURL,
        modelId: payload.modelId,
        contextWindowTokens: payload.contextWindowTokens,
        apiMode: payload.apiMode,
        apiKey: payload.apiKey,
      }
    : undefined;
  return invoke<EveSidecarInfo | null>('reload_eve_sidecar', { model });
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
