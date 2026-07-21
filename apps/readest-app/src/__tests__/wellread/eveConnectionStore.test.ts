import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEveSidecarInfo = vi.fn();
const probeEveHealth = vi.fn();

vi.mock('@/services/wellread/eveSidecar', () => ({
  getEveSidecarInfo: (...args: unknown[]) => getEveSidecarInfo(...args),
  probeEveHealth: (...args: unknown[]) => probeEveHealth(...args),
}));

describe('useEveConnectionStore.refresh', () => {
  beforeEach(() => {
    vi.resetModules();
    getEveSidecarInfo.mockReset();
    probeEveHealth.mockReset();
  });

  it('marks ready when Rust returns sidecar info even if browser health probe fails', async () => {
    const info = { baseUrl: 'http://127.0.0.1:43111', token: 'tok' };
    getEveSidecarInfo.mockResolvedValue(info);
    probeEveHealth.mockResolvedValue(false);

    const { useEveConnectionStore } = await import('@/services/wellread/eveConnectionStore');
    useEveConnectionStore.setState({ info: null, ready: false });

    const result = await useEveConnectionStore.getState().refresh();

    expect(result).toEqual(info);
    expect(useEveConnectionStore.getState().ready).toBe(true);
    expect(useEveConnectionStore.getState().info).toEqual(info);
    expect(probeEveHealth).not.toHaveBeenCalled();
  });

  it('stays not-ready when Rust has no sidecar info', async () => {
    getEveSidecarInfo.mockResolvedValue(null);

    const { useEveConnectionStore } = await import('@/services/wellread/eveConnectionStore');
    useEveConnectionStore.setState({ info: { baseUrl: 'x', token: 'y' }, ready: true });

    const result = await useEveConnectionStore.getState().refresh();

    expect(result).toBeNull();
    expect(useEveConnectionStore.getState().ready).toBe(false);
    expect(useEveConnectionStore.getState().info).toBeNull();
  });
});
