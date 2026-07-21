import { beforeEach, describe, expect, it, vi } from 'vitest';

const getModelApiKey = vi.fn();
const reloadEveSidecar = vi.fn();
const isTauriAppPlatform = vi.fn();

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: (...args: unknown[]) => isTauriAppPlatform(...args),
}));

vi.mock('@/services/wellread/modelApiKey', () => ({
  getModelApiKey: (...args: unknown[]) => getModelApiKey(...args),
}));

vi.mock('@/services/wellread/eveSidecar', () => ({
  reloadEveSidecar: (...args: unknown[]) => reloadEveSidecar(...args),
}));

describe('syncEveSidecarApiKey', () => {
  beforeEach(() => {
    vi.resetModules();
    getModelApiKey.mockReset();
    reloadEveSidecar.mockReset();
    isTauriAppPlatform.mockReset();
  });

  it('reloads the sidecar with the active profile keychain apiKey on Tauri', async () => {
    isTauriAppPlatform.mockReturnValue(true);
    getModelApiKey.mockResolvedValue('  sk-live  ');
    const info = { baseUrl: 'http://127.0.0.1:9', token: 'tok' };
    reloadEveSidecar.mockResolvedValue(info);

    const { syncEveSidecarApiKey } = await import('@/services/wellread/syncEveSidecarApiKey');
    const result = await syncEveSidecarApiKey({
      enabled: true,
      activeProfileId: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'Demo',
          baseURL: 'https://api.example.com/v1',
          modelId: 'demo',
          contextWindowTokens: 128_000,
          apiMode: 'chat',
        },
      ],
    });

    expect(result).toEqual(info);
    expect(getModelApiKey).toHaveBeenCalledWith('p1');
    expect(reloadEveSidecar).toHaveBeenCalledWith({
      enabled: true,
      baseURL: 'https://api.example.com/v1',
      modelId: 'demo',
      contextWindowTokens: 128_000,
      apiMode: 'chat',
      apiKey: 'sk-live',
    });
  });

  it('migrates a legacy single-track config then injects that profile key', async () => {
    isTauriAppPlatform.mockReturnValue(true);
    getModelApiKey.mockResolvedValue('sk-legacy');
    reloadEveSidecar.mockResolvedValue({ baseUrl: 'http://127.0.0.1:1', token: 't' });

    const { syncEveSidecarApiKey } = await import('@/services/wellread/syncEveSidecarApiKey');
    await syncEveSidecarApiKey({
      enabled: true,
      baseURL: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      apiMode: 'chat',
    } as never);

    expect(getModelApiKey).toHaveBeenCalledWith('deepseek-default');
    expect(reloadEveSidecar).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        modelId: 'deepseek-v4-flash',
        apiKey: 'sk-legacy',
      }),
    );
  });

  it('skips reload when keychain has no apiKey for the active profile', async () => {
    isTauriAppPlatform.mockReturnValue(true);
    getModelApiKey.mockResolvedValue('   ');

    const { syncEveSidecarApiKey } = await import('@/services/wellread/syncEveSidecarApiKey');
    const result = await syncEveSidecarApiKey({
      enabled: true,
      activeProfileId: 'p1',
      profiles: [
        {
          id: 'p1',
          name: 'Demo',
          baseURL: 'https://api.example.com/v1',
          modelId: 'demo',
          contextWindowTokens: 128_000,
          apiMode: 'chat',
        },
      ],
    });

    expect(result).toBeNull();
    expect(reloadEveSidecar).not.toHaveBeenCalled();
  });

  it('no-ops outside Tauri', async () => {
    isTauriAppPlatform.mockReturnValue(false);

    const { syncEveSidecarApiKey } = await import('@/services/wellread/syncEveSidecarApiKey');
    const result = await syncEveSidecarApiKey({ enabled: true });

    expect(result).toBeNull();
    expect(getModelApiKey).not.toHaveBeenCalled();
    expect(reloadEveSidecar).not.toHaveBeenCalled();
  });
});
