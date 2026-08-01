import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEveSidecarInfo = vi.fn();
const probeEveHealth = vi.fn();
const listen = vi.fn();

vi.mock('@/services/wellread/eveSidecar', () => ({
  EVE_SIDECAR_CHANGED_EVENT: 'eve-sidecar-changed',
  getEveSidecarInfo: (...args: unknown[]) => getEveSidecarInfo(...args),
  probeEveHealth: (...args: unknown[]) => probeEveHealth(...args),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listen(...args),
}));

describe('useEveConnectionStore', () => {
  beforeEach(() => {
    vi.resetModules();
    getEveSidecarInfo.mockReset();
    probeEveHealth.mockReset();
    listen.mockReset();
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

  it('clears store state when Rust has no sidecar info', async () => {
    getEveSidecarInfo.mockResolvedValue(null);

    const { useEveConnectionStore } = await import('@/services/wellread/eveConnectionStore');
    useEveConnectionStore.setState({ info: { baseUrl: 'x', token: 'y' }, ready: true });

    const result = await useEveConnectionStore.getState().refresh();

    expect(result).toBeNull();
    expect(useEveConnectionStore.getState().ready).toBe(false);
    expect(useEveConnectionStore.getState().info).toBeNull();
  });

  it('applies eve-sidecar-changed events from Rust', async () => {
    const handlers: Array<(event: { payload: unknown }) => void> = [];
    listen.mockImplementation(async (_event: string, cb: (event: { payload: unknown }) => void) => {
      handlers.push(cb);
      return () => {
        const idx = handlers.indexOf(cb);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    });

    const { startEveConnectionSync, useEveConnectionStore } = await import(
      '@/services/wellread/eveConnectionStore'
    );
    useEveConnectionStore.setState({ info: null, ready: false });
    await startEveConnectionSync();

    const info = { baseUrl: 'http://127.0.0.1:49576', token: 'new' };
    handlers[0]!({ payload: info });

    expect(useEveConnectionStore.getState().info).toEqual(info);
    expect(useEveConnectionStore.getState().ready).toBe(true);
  });

  it('keeps one listener across overlapping subscribe/unsubscribe (Strict Mode)', async () => {
    let listenCalls = 0;
    let activeListeners = 0;
    listen.mockImplementation(
      async (_event: string, _cb: (event: { payload: unknown }) => void) => {
        listenCalls += 1;
        activeListeners += 1;
        return () => {
          activeListeners -= 1;
        };
      },
    );

    const { startEveConnectionSync } = await import('@/services/wellread/eveConnectionStore');
    const first = startEveConnectionSync();
    const second = startEveConnectionSync();
    const stopFirst = await first;
    const stopSecond = await second;

    expect(listenCalls).toBe(1);
    expect(activeListeners).toBe(1);

    stopFirst();
    expect(activeListeners).toBe(1);
    stopSecond();
    expect(activeListeners).toBe(0);
  });
});
