import { timingSafeEqual } from 'node:crypto';

/**
 * Fail-closed loopback token: production always requires EVE_LOOPBACK_TOKEN.
 * Opt-in escape hatch for local debug: EVE_ALLOW_NO_TOKEN=1.
 */

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {{ ok: true, token: string } | { ok: false, reason: string }}
 */
export function resolveLoopbackToken(env = process.env) {
  const token = String(env.EVE_LOOPBACK_TOKEN || '').trim();
  if (token) return { ok: true, token };
  if (String(env.EVE_ALLOW_NO_TOKEN || '').trim() === '1') {
    return { ok: true, token: '' };
  }
  return {
    ok: false,
    reason:
      'EVE_LOOPBACK_TOKEN is required (set EVE_ALLOW_NO_TOKEN=1 only for local debug)',
  };
}

/**
 * Constant-time check of an `Authorization` header against the loopback token.
 * @param {string | undefined} header
 * @param {string} token
 */
export function tokenMatches(header, token) {
  const got = Buffer.from(String(header || ''));
  const want = Buffer.from(`Bearer ${token}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
