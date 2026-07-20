import { stubTranslation as _ } from '@/utils/misc';

export type TestModelConnectionInput = {
  baseURL: string;
  apiKey: string;
  modelId: string;
};

export type TestModelConnectionResult = { ok: true } | { ok: false; error: string };

/**
 * Minimal connectivity check against the user's OpenAI-compatible baseURL.
 * Never contacts ai-gateway.vercel.sh.
 */
export async function testModelConnection(
  input: TestModelConnectionInput,
): Promise<TestModelConnectionResult> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    return { ok: false, error: _('API key is required') };
  }

  const base = input.baseURL.replace(/\/+$/, '');
  const url = `${base}/models`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `${_('Connection failed')} (${response.status})`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
