import { beforeEach, describe, expect, it, vi } from 'vitest';

const getModelApiKey = vi.fn();
const ensureEveSidecarCommand = vi.fn();
const isTauriAppPlatform = vi.fn();

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: (...args: unknown[]) => isTauriAppPlatform(...args),
}));

vi.mock('@/services/wellread/modelApiKey', () => ({
  getModelApiKey: (...args: unknown[]) => getModelApiKey(...args),
}));

vi.mock('@/services/wellread/eveSidecar', () => ({
  ensureEveSidecar: (...args: unknown[]) => ensureEveSidecarCommand(...args),
}));

describe('ensureEveSidecar', () => {
  beforeEach(() => {
    vi.resetModules();
    getModelApiKey.mockReset();
    ensureEveSidecarCommand.mockReset();
    isTauriAppPlatform.mockReset();
  });

  it('ensures the sidecar with the active profile keychain apiKey on Tauri', async () => {
    isTauriAppPlatform.mockReturnValue(true);
    getModelApiKey.mockResolvedValue('  sk-live  ');
    const info = { baseUrl: 'http://127.0.0.1:9', token: 'tok' };
    ensureEveSidecarCommand.mockResolvedValue(info);

    const { ensureEveSidecar } = await import('@/services/wellread/ensureEveSidecar');
    const result = await ensureEveSidecar({
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
    expect(ensureEveSidecarCommand).toHaveBeenCalledWith({
      enabled: true,
      baseURL: 'https://api.example.com/v1',
      modelId: 'demo',
      contextWindowTokens: 128_000,
      apiMode: 'chat',
      apiKey: 'sk-live',
    });
  });

  it('migrates a legacy single-track config then ensures with that profile key', async () => {
    isTauriAppPlatform.mockReturnValue(true);
    getModelApiKey.mockResolvedValue('sk-legacy');
    ensureEveSidecarCommand.mockResolvedValue({ baseUrl: 'http://127.0.0.1:1', token: 't' });

    const { ensureEveSidecar } = await import('@/services/wellread/ensureEveSidecar');
    await ensureEveSidecar({
      enabled: true,
      baseURL: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      apiMode: 'chat',
    } as never);

    expect(getModelApiKey).toHaveBeenCalledWith('deepseek-default');
    expect(ensureEveSidecarCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        modelId: 'deepseek-v4-flash',
        apiKey: 'sk-legacy',
      }),
    );
  });

  it('ensures with empty apiKey when keychain has none so profile fields still apply', async () => {
    isTauriAppPlatform.mockReturnValue(true);
    getModelApiKey.mockResolvedValue('   ');
    ensureEveSidecarCommand.mockResolvedValue({ baseUrl: 'http://127.0.0.1:2', token: 't' });

    const { ensureEveSidecar } = await import('@/services/wellread/ensureEveSidecar');
    const result = await ensureEveSidecar({
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

    expect(result).toEqual({ baseUrl: 'http://127.0.0.1:2', token: 't' });
    expect(ensureEveSidecarCommand).toHaveBeenCalledWith({
      enabled: true,
      baseURL: 'https://api.example.com/v1',
      modelId: 'demo',
      contextWindowTokens: 128_000,
      apiMode: 'chat',
      apiKey: '',
    });
  });

  it('stops the sidecar when AI is disabled', async () => {
    isTauriAppPlatform.mockReturnValue(true);
    ensureEveSidecarCommand.mockResolvedValue(null);

    const { ensureEveSidecar } = await import('@/services/wellread/ensureEveSidecar');
    const result = await ensureEveSidecar({
      enabled: false,
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
    expect(getModelApiKey).not.toHaveBeenCalled();
    expect(ensureEveSidecarCommand).toHaveBeenCalledWith({ enabled: false });
  });

  it('no-ops outside Tauri', async () => {
    isTauriAppPlatform.mockReturnValue(false);

    const { ensureEveSidecar } = await import('@/services/wellread/ensureEveSidecar');
    const result = await ensureEveSidecar({ enabled: true });

    expect(result).toBeNull();
    expect(getModelApiKey).not.toHaveBeenCalled();
    expect(ensureEveSidecarCommand).not.toHaveBeenCalled();
  });
});
