/**
 * Cold-start bridge: Rust bootstrap does not spawn (cannot read OS keychain).
 * After settings load, start/reload the sidecar once with the active
 * ModelProfile + keychain apiKey so cold start is a single process start.
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
  if (!config.enabled) {
    return reloadEveSidecar({ enabled: false });
  }
  const active = getActiveProfile(config);
  if (!active) return null;
  const apiKey = (await getModelApiKey(active.id)).trim();
  const payload = toSidecarModelPayload(config);
  if (!payload) return null;
  return reloadEveSidecar({ ...payload, apiKey });
}
