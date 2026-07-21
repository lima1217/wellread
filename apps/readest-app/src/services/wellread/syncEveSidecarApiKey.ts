/**
 * Cold-start bridge: Rust bootstrap reads ModelConfig from settings.json but
 * cannot read the OS keychain (apiKey is frontend-owned). After settings load,
 * inject the active profile's key so the sidecar is model-ready without
 * requiring a re-save in Settings → AI.
 */

import { isTauriAppPlatform } from '@/services/environment';
import { getModelApiKey } from './modelApiKey';
import {
  getActiveProfile,
  mergeModelConfig,
  toSidecarModelPayload,
  type ModelConfig,
} from './modelConfig';
import { reloadEveSidecar, type EveSidecarInfo } from './eveSidecar';

export async function syncEveSidecarApiKey(
  modelConfig?: Partial<ModelConfig> | null,
): Promise<EveSidecarInfo | null> {
  if (!isTauriAppPlatform()) return null;
  const config = mergeModelConfig(modelConfig);
  const active = getActiveProfile(config);
  if (!active) return null;
  const apiKey = (await getModelApiKey(active.id)).trim();
  if (!apiKey) return null;
  const payload = toSidecarModelPayload(config);
  if (!payload) return null;
  return reloadEveSidecar({ ...payload, apiKey });
}
