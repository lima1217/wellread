import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSecureItem = vi.fn();
const setSecureItem = vi.fn();
const clearSecureItem = vi.fn();
const isTauriAppPlatform = vi.fn();

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: (...args: unknown[]) => isTauriAppPlatform(...args),
}));

vi.mock('@/utils/bridge', () => ({
  getSecureItem: (...args: unknown[]) => getSecureItem(...args),
  setSecureItem: (...args: unknown[]) => setSecureItem(...args),
  clearSecureItem: (...args: unknown[]) => clearSecureItem(...args),
}));

describe('modelApiKey (per-profile slots)', () => {
  beforeEach(() => {
    vi.resetModules();
    getSecureItem.mockReset();
    setSecureItem.mockReset();
    clearSecureItem.mockReset();
    isTauriAppPlatform.mockReset();
    isTauriAppPlatform.mockReturnValue(true);
  });

  it('reads the per-profile keychain slot', async () => {
    getSecureItem.mockResolvedValue({ value: 'sk-profile' });
    const { getModelApiKey } = await import('@/services/wellread/modelApiKey');
    await expect(getModelApiKey('p1')).resolves.toBe('sk-profile');
    expect(getSecureItem).toHaveBeenCalledWith({ key: 'wellread.model.apiKey.p1' });
  });

  it('migrates the legacy single-slot key into the profile slot', async () => {
    getSecureItem.mockImplementation(async ({ key }: { key: string }) => {
      if (key === 'wellread.model.apiKey.p1') return { value: '' };
      if (key === 'wellread.model.apiKey') return { value: 'sk-legacy' };
      return { value: '' };
    });
    setSecureItem.mockResolvedValue(undefined);
    clearSecureItem.mockResolvedValue(undefined);

    const { getModelApiKey } = await import('@/services/wellread/modelApiKey');
    await expect(getModelApiKey('p1')).resolves.toBe('sk-legacy');
    expect(setSecureItem).toHaveBeenCalledWith({
      key: 'wellread.model.apiKey.p1',
      value: 'sk-legacy',
    });
    expect(clearSecureItem).toHaveBeenCalledWith({ key: 'wellread.model.apiKey' });
  });

  it('setModelApiKey writes the profile slot; empty clears it', async () => {
    const { setModelApiKey } = await import('@/services/wellread/modelApiKey');
    await setModelApiKey('p1', '  sk-new  ');
    expect(setSecureItem).toHaveBeenCalledWith({
      key: 'wellread.model.apiKey.p1',
      value: 'sk-new',
    });
    await setModelApiKey('p1', '  ');
    expect(clearSecureItem).toHaveBeenCalledWith({ key: 'wellread.model.apiKey.p1' });
  });

  it('clearModelApiKey removes the profile slot on delete', async () => {
    const { clearModelApiKey } = await import('@/services/wellread/modelApiKey');
    await clearModelApiKey('gone');
    expect(clearSecureItem).toHaveBeenCalledWith({ key: 'wellread.model.apiKey.gone' });
  });
});
