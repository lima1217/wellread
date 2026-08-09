/**
 * Shared model-host helpers for Reading Assistant (FE profile normalize +
 * eve-sidecar provider gates). Keep DeepSeek hostname rules in one place.
 */

/**
 * @param {string | undefined | null} baseURL
 * @returns {boolean}
 */
export function isDeepSeekApiHost(baseURL) {
  if (!baseURL || typeof baseURL !== 'string') return false;
  try {
    const host = new URL(baseURL).hostname.toLowerCase();
    return host === 'api.deepseek.com' || host.endsWith('.deepseek.com');
  } catch {
    return false;
  }
}
