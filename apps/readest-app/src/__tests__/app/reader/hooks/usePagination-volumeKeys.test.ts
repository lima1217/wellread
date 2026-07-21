import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// Real deviceStore + eventDispatcher; only the native bridge boundary is mocked
// so we can observe the interceptKeys({ volumeKeys }) calls the store makes.
const h = vi.hoisted(() => ({
  appService: { isMobileApp: true } as { isMobileApp: boolean },
  viewSettings: { volumeKeysToFlip: true } as Record<string, unknown> | null,
  viewState: { inited: true } as Record<string, unknown> | null,
  settingsState: { settings: { hardwarePageTurner: undefined } },
}));

vi.mock('@/utils/bridge', () => ({
  interceptKeys: vi.fn(),
  getScreenBrightness: vi.fn(),
  setScreenBrightness: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(
    () => ({
      getViewSettings: () => h.viewSettings,
      getViewState: () => h.viewState,
      hoveredBookKey: null,
      setHoveredBookKey: vi.fn(),
    }),
    { getState: () => ({ hoveredBookKey: null }) },
  ),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({}) }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector?: (s: typeof h.settingsState) => unknown) =>
      selector ? selector(h.settingsState) : h.settingsState,
    { getState: () => h.settingsState },
  ),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: Object.assign(() => ({}), { getState: () => ({ sideBarBookKey: 'book-1' }) }),
}));

import { interceptKeys } from '@/utils/bridge';
import { useDeviceControlStore } from '@/store/deviceStore';
import { usePagination } from '@/app/reader/hooks/usePagination';

const BOOK_KEY = 'book-1';

const setup = () => {
  const viewRef = { current: null };
  const containerRef = { current: null };
  return renderHook(() => usePagination(BOOK_KEY, viewRef, containerRef));
};

beforeEach(() => {
  useDeviceControlStore.setState({
    volumeKeysIntercepted: false,
    volumeKeysInterceptionCount: 0,
    pageTurnerKeysIntercepted: false,
    pageTurnerKeysInterceptionCount: 0,
  });
  vi.clearAllMocks();
  h.appService = { isMobileApp: true };
  h.viewSettings = { volumeKeysToFlip: true };
  h.viewState = { inited: true };
});

afterEach(() => {
  cleanup();
});

describe('usePagination volume-key interception', () => {
  test('intercepts volume keys on mount when the setting is on', () => {
    setup();
    expect(interceptKeys).toHaveBeenCalledWith({ volumeKeys: true });
    expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(true);
  });

  test('does not intercept volume keys when the setting is off', () => {
    h.viewSettings = { volumeKeysToFlip: false };
    setup();
    expect(interceptKeys).not.toHaveBeenCalledWith({ volumeKeys: true });
    expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(false);
  });
});
