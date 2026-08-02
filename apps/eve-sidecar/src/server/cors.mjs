/**
 * CORS for the loopback Reading Assistant sidecar.
 *
 * Production Tauri calls go through plugin-http (no browser CORS). Browser
 * `fetch` and preflight still need an allowlist so a random page cannot
 * cross-origin-drive 127.0.0.1 — especially under EVE_ALLOW_NO_TOKEN=1.
 *
 * Never reflect an arbitrary Origin. Unknown origins omit
 * Access-Control-Allow-Origin so the browser blocks the response.
 */

/** Origins used by wellread's Tauri / Next webviews. */
export const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'tauri://localhost',
]);

/**
 * @param {string | undefined | null} value
 * @returns {string[]}
 */
export function parseCorsOriginsEnv(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {Iterable<string>} [extra]
 * @returns {Set<string>}
 */
export function buildAllowedOriginSet(extra = []) {
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra]);
}

/**
 * @param {string | undefined | null} origin
 * @param {Set<string>} allowed
 */
export function isAllowedCorsOrigin(origin, allowed) {
  return typeof origin === 'string' && origin.length > 0 && allowed.has(origin);
}

/**
 * @param {{ headers?: { origin?: string } } | null | undefined} req
 * @param {{ allowedOrigins?: Set<string> }} [options]
 * @returns {Record<string, string>}
 */
export function corsHeaders(req, options = {}) {
  const allowed = options.allowedOrigins ?? buildAllowedOriginSet();
  const origin = req?.headers?.origin;
  /** @type {Record<string, string>} */
  const headers = {
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
  if (isAllowedCorsOrigin(origin, allowed)) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
}
