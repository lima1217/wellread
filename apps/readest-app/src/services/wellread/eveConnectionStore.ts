/**
 * Eve sidecar readiness for the frontend.
 * Spec: inject { baseUrl, token } so clients can hit /eve/v1 with Authorization.
 */

import { create } from 'zustand';
import { getEveSidecarInfo, probeEveHealth, type EveSidecarInfo } from './eveSidecar';

type EveConnectionState = {
  info: EveSidecarInfo | null;
  ready: boolean;
  refresh: () => Promise<EveSidecarInfo | null>;
};

export const useEveConnectionStore = create<EveConnectionState>((set) => ({
  info: null,
  ready: false,
  refresh: async () => {
    const info = await getEveSidecarInfo();
    if (!info) {
      set({ info: null, ready: false });
      return null;
    }
    const ready = await probeEveHealth(info);
    set({ info, ready });
    if (typeof window !== 'undefined') {
      (window as Window & { EVE_BASE_URL?: string; EVE_LOOPBACK_TOKEN?: string }).EVE_BASE_URL =
        info.baseUrl;
      (
        window as Window & { EVE_BASE_URL?: string; EVE_LOOPBACK_TOKEN?: string }
      ).EVE_LOOPBACK_TOKEN = info.token;
    }
    return info;
  },
}));
