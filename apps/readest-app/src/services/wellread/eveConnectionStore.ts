/**
 * Eve sidecar readiness for the frontend.
 *
 * Rust owns listen URL + token (process-global). This store mirrors that state
 * per webview via `get_eve_sidecar_info` and `eve-sidecar-changed` events so
 * multi-window boots cannot keep a stale PORT after another window ensures.
 */

import { create } from 'zustand';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauriAppPlatform } from '@/services/environment';
import { EVE_SIDECAR_CHANGED_EVENT, getEveSidecarInfo, type EveSidecarInfo } from './eveSidecar';

type EveConnectionState = {
  info: EveSidecarInfo | null;
  ready: boolean;
  refresh: () => Promise<EveSidecarInfo | null>;
  /** Apply info from ensure/reload return value or a broadcast event. */
  applyInfo: (info: EveSidecarInfo | null) => void;
};

function applyInfoToState(
  set: (partial: Partial<EveConnectionState>) => void,
  info: EveSidecarInfo | null,
): EveSidecarInfo | null {
  if (!info) {
    set({ info: null, ready: false });
    return null;
  }
  set({ info, ready: true });
  return info;
}

export const useEveConnectionStore = create<EveConnectionState>((set) => ({
  info: null,
  ready: false,
  applyInfo: (info) => {
    applyInfoToState(set, info);
  },
  refresh: async () => {
    const info = await getEveSidecarInfo();
    return applyInfoToState(set, info);
  },
}));

let syncUnlisten: UnlistenFn | null = null;
let syncPromise: Promise<void> | null = null;
let syncSubscribers = 0;

/** Subscribe once per webview to Rust connection broadcasts. */
export async function startEveConnectionSync(): Promise<() => void> {
  if (!isTauriAppPlatform()) return () => {};
  syncSubscribers += 1;
  if (!syncPromise) {
    syncPromise = listen<EveSidecarInfo | null>(EVE_SIDECAR_CHANGED_EVENT, (event) => {
      useEveConnectionStore.getState().applyInfo(event.payload ?? null);
    }).then((unlisten) => {
      syncUnlisten = unlisten;
    });
  }
  await syncPromise;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    syncSubscribers -= 1;
    if (syncSubscribers <= 0) {
      syncUnlisten?.();
      syncUnlisten = null;
      syncPromise = null;
      syncSubscribers = 0;
    }
  };
}
