import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import type { ModelConfig } from './modelConfig';

export type EveSidecarInfo = {
  baseUrl: string;
  token: string;
};

export type ReloadEveSidecarPayload = Partial<ModelConfig> & {
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
 * Ask Rust to restart the eve sidecar with the latest ModelConfig + apiKey
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
