/**
 * Eve sidecar readiness for the frontend.
 * Spec: inject { baseUrl, token } so clients can hit /eve/v1 with Authorization.
 *
 * Readiness comes from Rust `get_eve_sidecar_info` only: that command returns
 * info after a no-proxy loopback health check. A second browser `fetch` probe
 * is unreliable (system HTTP proxies like Clash/V2Ray often 502 loopback) and
 * left the Notebook AI tab spinning forever while the sidecar was healthy.
 */

import { create } from 'zustand';
import { getEveSidecarInfo, type EveSidecarInfo } from './eveSidecar';

type EveConnectionState = {
  info: EveSidecarInfo | null;
  ready: boolean;
  refresh: () => Promise<EveSidecarInfo | null>;
};

function injectEveWindowGlobals(info: EveSidecarInfo): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { EVE_BASE_URL?: string; EVE_LOOPBACK_TOKEN?: string };
  w.EVE_BASE_URL = info.baseUrl;
  w.EVE_LOOPBACK_TOKEN = info.token;
}

export const useEveConnectionStore = create<EveConnectionState>((set) => ({
  info: null,
  ready: false,
  refresh: async () => {
    const info = await getEveSidecarInfo();
    if (!info) {
      set({ info: null, ready: false });
      return null;
    }
    set({ info, ready: true });
    injectEveWindowGlobals(info);
    return info;
  },
}));
