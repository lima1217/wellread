/**
 * Connectivity check for a BYO OpenAI-compatible model endpoint.
 *
 * Runs inside the sidecar so the probe shares the real model call's network
 * path: Node fetch from this process, with the same host adapters as
 * production turns. An endpoint that passes here is one the turn loop can
 * actually reach, without WebView fetch or system-proxy interference.
 */

import { bindTurnFetchPatch } from '../createModel.mjs';

/**
 * @param {{
 *   baseURL?: string | null,
 *   apiKey?: string | null,
 *   apiMode?: string | null,
 *   baseFetch?: typeof fetch,
 *   timeoutMs?: number,
 * }} [input]
 * @returns {Promise<{ ok: true } | { ok: false; error: string }>}
 */
export async function testModelConnection(input = {}) {
  const apiKey = (input.apiKey || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'API key is required' };
  }
  const base = (input.baseURL || '').trim().replace(/\/+$/, '');
  if (!base) {
    return { ok: false, error: 'Base URL is required' };
  }

  const fetchWithPatch = bindTurnFetchPatch(input.baseFetch, {
    apiMode: input.apiMode || 'chat',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);
  try {
    const response = await fetchWithPatch(`${base}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: `Connection failed (${response.status})` };
    }
    return { ok: true };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, error: 'Connection timed out' };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
