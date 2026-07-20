import { afterEach, describe, expect, it, vi } from 'vitest';
import { testModelConnection } from '@/services/wellread/testModelConnection';

describe('testModelConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fails when apiKey is empty without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await testModelConnection({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: '',
      modelId: 'deepseek-v4-flash',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/api key/i);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GETs models on the user baseURL only', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe('https://api.deepseek.com/v1/models');
      expect(url).not.toContain('ai-gateway.vercel.sh');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sk-test');
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await testModelConnection({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      modelId: 'deepseek-v4-flash',
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports HTTP errors from the user endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401, statusText: 'Unauthorized' })),
    );
    const result = await testModelConnection({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'bad',
      modelId: 'deepseek-v4-flash',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/401/);
    }
  });
});
