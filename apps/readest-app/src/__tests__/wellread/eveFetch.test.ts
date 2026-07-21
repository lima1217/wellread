import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriFetch = vi.fn();
const isTauriAppPlatform = vi.fn();

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (...args: unknown[]) => tauriFetch(...args),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => isTauriAppPlatform(),
}));

describe('eveFetch', () => {
  beforeEach(() => {
    vi.resetModules();
    tauriFetch.mockReset();
    isTauriAppPlatform.mockReset();
    tauriFetch.mockResolvedValue(new Response('{}', { status: 200 }));
  });

  it('uses Tauri HTTP with loopback noProxy so system Clash/V2Ray proxies cannot break sidecar calls', async () => {
    isTauriAppPlatform.mockReturnValue(true);
    const { eveFetch } = await import('@/services/wellread/assistant/eveFetch');

    await eveFetch('http://127.0.0.1:43111/eve/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(tauriFetch).toHaveBeenCalledTimes(1);
    const [, init] = tauriFetch.mock.calls[0]!;
    expect(init.proxy).toEqual({
      all: {
        url: 'http://127.0.0.1:9',
        noProxy: '127.0.0.1,localhost,::1',
      },
    });
  });

  it('falls back to window.fetch off Tauri', async () => {
    isTauriAppPlatform.mockReturnValue(false);
    const windowFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const { eveFetch } = await import('@/services/wellread/assistant/eveFetch');

    await eveFetch('http://127.0.0.1:43111/eve/v1');

    expect(tauriFetch).not.toHaveBeenCalled();
    expect(windowFetch).toHaveBeenCalled();
    windowFetch.mockRestore();
  });
});
