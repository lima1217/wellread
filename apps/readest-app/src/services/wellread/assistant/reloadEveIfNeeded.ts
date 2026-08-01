/**
 * Shared active-model hot reload for settings panels and composer profile switch.
 */

import {
  getActiveProfile,
  shouldHotReloadEve,
  toSidecarModelPayload,
  type ModelConfig,
} from '@/services/wellread/modelConfig';
import { getModelApiKey } from '@/services/wellread/modelApiKey';
import { reloadEveSidecar } from '@/services/wellread/eveSidecar';
import { useEveConnectionStore } from '@/services/wellread/eveConnectionStore';

export type ReloadEveIfNeededOptions = {
  previousActiveId: string | null;
  /** When set (e.g. AIPanel toggle), forces reload even if active pointer unchanged. */
  force?: boolean;
  editedProfileId?: string | null;
  /** Prefer this key when the edited profile is the active one (avoid stale keychain read). */
  editedApiKey?: string;
  /** Default true — callers that refresh themselves can pass false. */
  refreshConnection?: boolean;
};

/**
 * Restart eve when the active profile pointer/row changes (or force).
 * No-op when shouldHotReloadEve is false and force is not set.
 */
export async function reloadEveIfNeeded(
  next: ModelConfig,
  opts: ReloadEveIfNeededOptions,
): Promise<void> {
  const needsReload =
    opts.force === true ||
    shouldHotReloadEve({
      previousActiveId: opts.previousActiveId,
      nextActiveId: next.activeProfileId,
      editedProfileId: opts.editedProfileId ?? null,
    });

  if (needsReload) {
    const active = getActiveProfile(next);
    if (active) {
      const apiKey =
        opts.editedProfileId === active.id && opts.editedApiKey !== undefined
          ? opts.editedApiKey
          : await getModelApiKey(active.id);
      const payload = toSidecarModelPayload(next);
      if (payload) {
        await reloadEveSidecar({ ...payload, apiKey });
      }
    } else {
      await reloadEveSidecar({ enabled: next.enabled });
    }
  }

  if (opts.refreshConnection !== false) {
    await useEveConnectionStore.getState().refresh();
  }
}
