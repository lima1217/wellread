import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { AppService } from '@/types/system';

type OnceHandler = (event?: { event: string; id: number; payload?: unknown }) => void;

const webviewWindowCtor = vi.fn();
const liveLabels = new Set<string>();
const onceHandlers = new Map<string, Map<string, OnceHandler>>();

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: class {
    label: string;
    constructor(label: string, options: Record<string, unknown>) {
      this.label = label;
      if (liveLabels.has(label)) {
        // Mirror Tauri's WindowLabelAlreadyExists path: fire tauri://error.
        queueMicrotask(() => {
          onceHandlers.get(label)?.get('tauri://error')?.({
            event: 'tauri://error',
            id: -1,
            payload: `a window with label \`${label}\` already exists`,
          });
        });
      } else {
        liveLabels.add(label);
        queueMicrotask(() => {
          onceHandlers.get(label)?.get('tauri://created')?.({
            event: 'tauri://created',
            id: -1,
          });
        });
      }
      webviewWindowCtor(label, options);
    }
    once(event: string, handler: OnceHandler) {
      let byEvent = onceHandlers.get(this.label);
      if (!byEvent) {
        byEvent = new Map();
        onceHandlers.set(this.label, byEvent);
      }
      byEvent.set(event, handler);
    }
    show() {}
  },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
  ScrollBarStyle: {},
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
  isWebAppPlatform: () => false,
  isPWA: () => false,
}));

const makeAppService = (os: 'macos' | 'windows' | 'linux'): AppService =>
  ({
    isMacOSApp: os === 'macos',
    isWindowsApp: os === 'windows',
    isLinuxApp: os === 'linux',
    osPlatform: os,
  }) as unknown as AppService;

async function loadShowReaderWindow() {
  vi.resetModules();
  liveLabels.clear();
  onceHandlers.clear();
  webviewWindowCtor.mockClear();
  const nav = await import('@/utils/nav');
  return nav.showReaderWindow;
}

function destroyLabel(label: string) {
  liveLabels.delete(label);
  onceHandlers.get(label)?.get('tauri://destroyed')?.();
  onceHandlers.delete(label);
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

// Regression (#3682): reader/extra windows opened via nav.ts must also be
// opaque on Linux — a transparent WebKitGTK window goes invisible when the web
// process is busy. Only macOS (native decorations) stays non-transparent by
// design; Windows keeps its existing behavior.
describe('nav.ts window transparency', () => {
  beforeEach(() => {
    webviewWindowCtor.mockClear();
  });

  test('Linux reader window is not transparent', async () => {
    const showReaderWindow = await loadShowReaderWindow();
    showReaderWindow(makeAppService('linux'), ['book-1']);
    expect(webviewWindowCtor).toHaveBeenCalledTimes(1);
    const options = webviewWindowCtor.mock.calls[0]![1] as Record<string, unknown>;
    expect(options['transparent']).toBe(false);
  });

  test('macOS reader window is not transparent (native decorations)', async () => {
    const showReaderWindow = await loadShowReaderWindow();
    showReaderWindow(makeAppService('macos'), ['book-1']);
    const options = webviewWindowCtor.mock.calls[0]![1] as Record<string, unknown>;
    expect(options['transparent']).toBe(false);
  });
});

describe('nav.ts reader window labels', () => {
  test('closing an earlier window does not reuse a still-live label', async () => {
    const showReaderWindow = await loadShowReaderWindow();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    showReaderWindow(makeAppService('macos'), ['book-a']);
    await flushMicrotasks();
    showReaderWindow(makeAppService('macos'), ['book-b']);
    await flushMicrotasks();

    const labels = webviewWindowCtor.mock.calls.map((c) => c[0] as string);
    expect(labels).toEqual(['reader-0', 'reader-1']);

    // Close the first window while the second is still open — the old counter
    // decremented here and then reused reader-1, colliding with the live window.
    destroyLabel('reader-0');
    showReaderWindow(makeAppService('macos'), ['book-c']);
    await flushMicrotasks();

    const thirdLabel = webviewWindowCtor.mock.calls[2]![0] as string;
    expect(thirdLabel).not.toBe('reader-1');
    expect(liveLabels.has(thirdLabel)).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('rapid opens before created callbacks still get unique labels', async () => {
    const showReaderWindow = await loadShowReaderWindow();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    showReaderWindow(makeAppService('macos'), ['book-a']);
    showReaderWindow(makeAppService('macos'), ['book-b']);
    await flushMicrotasks();

    const labels = webviewWindowCtor.mock.calls.map((c) => c[0] as string);
    expect(new Set(labels).size).toBe(labels.length);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
