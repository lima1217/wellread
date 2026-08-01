/**
 * Cold-start / multi-window bridge: Rust bootstrap does not spawn (cannot read
 * OS keychain). After settings load, ensure the sidecar is up with the active
 * ModelProfile + keychain apiKey. Unlike reload, ensure skips respawn when the
 * running process already matches the resolved fingerprint.
 */

import { isTauriAppPlatform } from '@/services/environment';
import { getModelApiKey } from './modelApiKey';
import {
  getActiveProfile,
  mergeModelConfig,
  toSidecarModelPayload,
  type ModelConfig,
} from './modelConfig';
import { ensureEveSidecar as ensureEveSidecarCommand, type EveSidecarInfo } from './eveSidecar';

export async function ensureEveSidecar(
  modelConfig?: Partial<ModelConfig> | null,
): Promise<EveSidecarInfo | null> {
  if (!isTauriAppPlatform()) return null;
  const config = mergeModelConfig(modelConfig);
  if (!config.enabled) {
    return ensureEveSidecarCommand({ enabled: false });
  }
  const active = getActiveProfile(config);
  if (!active) return null;
  const apiKey = (await getModelApiKey(active.id)).trim();
  const payload = toSidecarModelPayload(config);
  if (!payload) return null;
  return ensureEveSidecarCommand({ ...payload, apiKey });
}
