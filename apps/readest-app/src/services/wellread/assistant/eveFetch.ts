/**
 * HTTP for the local eve sidecar.
 *
 * Browser `fetch` from the Tauri webview (localhost / tauri.localhost) to
 * `http://127.0.0.1:<port>` is cross-origin; the sidecar has no CORS, so Safari
 * surfaces TypeError "Load failed". On Tauri we use plugin-http (no CORS) and
 * disable system proxies for loopback — reqwest otherwise routes Clash/V2Ray
 * at 127.0.0.1 and 502s a healthy sidecar (same class of bug as Rust health_ok).
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauriAppPlatform } from '@/services/environment';

/** Explicit proxy with loopback excluded disables reqwest's default system proxy. */
export const EVE_LOOPBACK_PROXY = {
  all: {
    url: 'http://127.0.0.1:9',
    noProxy: '127.0.0.1,localhost,::1',
  },
} as const;

export async function eveFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauriAppPlatform()) {
    return tauriFetch(input, {
      ...init,
      proxy: EVE_LOOPBACK_PROXY,
    });
  }
  return fetch(input, init);
}
