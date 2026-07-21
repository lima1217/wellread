import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor as waitForWithOptions,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ParagraphOverlay from '@/app/reader/components/paragraph/ParagraphOverlay';
import { useParagraphMode } from '@/app/reader/hooks/useParagraphMode';
import type { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';
import {
  getParagraphActionForKey,
  getParagraphActionForZone,
  getParagraphPresentation,
} from '@/utils/paragraphPresentation';

const currentViewSettings = {
  paragraphMode: { enabled: true },
  writingMode: 'horizontal-tb',
  vertical: false,
  rtl: false,
};

const mockGetViewSettings = vi.fn(() => currentViewSettings);
const mockSetViewSettings = vi.fn();
const mockGetProgress = vi.fn(() => null);
const realSetTimeout = globalThis.setTimeout;
const waitFor = <T,>(callback: () => T | Promise<T>) =>
  waitForWithOptions(callback, { interval: 1 });

beforeEach(() => {
  // Preserve Testing Library's 1s failure timeout while collapsing app animation/debounce waits.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, timeout) =>
    realSetTimeout(handler, typeof timeout === 'number' && timeout < 500 ? 0 : timeout),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

let mockIsFixedLayout = false;

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ isFixedLayout: mockIsFixedLayout }),
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { hasSafeAreaInset: false } }),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn(),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getViewSettings: mockGetViewSettings,
    setViewSettings: mockSetViewSettings,
    getProgress: mockGetProgress,
  }),
}));

global.ResizeObserver = class ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this);
  }

  disconnect() {}

  unobserve() {}
} as typeof ResizeObserver;

const createDoc = (body: string): Document =>
  new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');

const attachDefaultView = (
  doc: Document,
  getComputedStyle: (element: Element) => CSSStyleDeclaration,
) => {
  Object.defineProperty(doc, 'defaultView', {
    value: { getComputedStyle },
    configurable: true,
  });
};

function createMockView(docs: Document[], initialPrimaryIndex: number) {
  const contents = docs.map((doc, index) => ({ doc, index }));

  const renderer = {
    primaryIndex: initialPrimaryIndex,
    getContents: vi.fn(() => contents),
    nextSection: vi.fn(async () => {
      renderer.primaryIndex = Math.min(renderer.primaryIndex + 1, contents.length - 1);
    }),
    prevSection: vi.fn(async () => {
      renderer.primaryIndex = Math.max(renderer.primaryIndex - 1, 0);
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    goTo: vi.fn(),
    scrollToAnchor: vi.fn(),
  };

  const view = {
    renderer,
    resolveCFI: vi.fn(),
    getCFI: vi.fn(() => 'epubcfi(/6/4!/4/2/1:0)'),
  } as unknown as FoliateView;

  return { view, renderer };
}

let hookApi: ReturnType<typeof useParagraphMode> | null = null;

const HookHarness = ({ view }: { view: React.RefObject<FoliateView | null> }) => {
  hookApi = useParagraphMode({ bookKey: 'book-1', viewRef: view });
  return null;
};

describe('paragraph mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookApi = null;
    mockIsFixedLayout = false;
    currentViewSettings.writingMode = 'horizontal-tb';
    currentViewSettings.vertical = false;
    currentViewSettings.rtl = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('preserves source presentation and navigation rules', () => {
    const verticalDoc = createDoc('<p lang="ja">縦書きの段落です。</p>');
    const verticalParagraph = verticalDoc.querySelector('p')!;
    const verticalRange = verticalDoc.createRange();
    verticalRange.selectNodeContents(verticalParagraph);

    attachDefaultView(verticalDoc, (element: Element) => {
      if (element === verticalParagraph || element === verticalDoc.body) {
        return {
          writingMode: 'vertical-rl',
          direction: 'ltr',
          textOrientation: 'upright',
          unicodeBidi: 'plaintext',
          textAlign: 'start',
        } as CSSStyleDeclaration;
      }

      return {
        writingMode: 'horizontal-tb',
        direction: 'ltr',
      } as CSSStyleDeclaration;
    });

    const arabicDoc = createDoc('<p dir="rtl">هذا نص عربي</p>');
    const arabicParagraph = arabicDoc.querySelector('p')!;
    const arabicRange = arabicDoc.createRange();
    arabicRange.selectNodeContents(arabicParagraph);
    attachDefaultView(
      arabicDoc,
      () =>
        ({
          writingMode: 'horizontal-tb',
          direction: 'rtl',
          textAlign: 'start',
        }) as CSSStyleDeclaration,
    );

    expect(getParagraphPresentation(verticalDoc, verticalRange)).toEqual(
      expect.objectContaining({
        lang: 'ja',
        dir: 'ltr',
        writingMode: 'vertical-rl',
        vertical: true,
      }),
    );
    expect(getParagraphPresentation(arabicDoc, arabicRange)).toEqual(
      expect.objectContaining({
        dir: 'rtl',
        rtl: true,
      }),
    );

    expect(getParagraphActionForZone('left', { rtl: true, vertical: false })).toBe('next');
    expect(getParagraphActionForZone('top', { vertical: true, writingMode: 'vertical-rl' })).toBe(
      'prev',
    );
    expect(getParagraphActionForKey('ArrowLeft', { rtl: true, vertical: false })).toBe('next');
    expect(
      getParagraphActionForKey('ArrowLeft', { vertical: true, writingMode: 'vertical-rl' }),
    ).toBe('next');
  });

  it('uses the active primary section when moving across chapter boundaries', async () => {
    const previousChapterDoc = createDoc('<p>Old chapter ending</p>');
    const nextChapterDoc = createDoc('<h1>Chapter 2</h1><p>First paragraph</p>');
    const { view, renderer } = createMockView([previousChapterDoc, nextChapterDoc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Old chapter ending');
    });

    await act(async () => {
      await hookApi?.goToNextParagraph();
    });

    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Chapter 2');
    });

    expect(renderer.nextSection).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(renderer.goTo).toHaveBeenLastCalledWith(expect.objectContaining({ index: 1 }));
    });
  });

  it('resumes without scrolling the underlying view so repeated enter/exit cannot rewind (#4717)', async () => {
    const doc = createDoc('<p>Para A</p><p>Para B</p><p>Para C</p>');
    const { view, renderer } = createMockView([doc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange).toBeTruthy();
    });

    // Resuming/entering focuses the paragraph already at the reading position.
    // Scrolling the underlying view to that paragraph's start rewinds whenever it
    // began on an earlier page, so the view must NOT be moved on resume (#4717).
    expect(renderer.goTo).not.toHaveBeenCalled();
    expect(renderer.scrollToAnchor).not.toHaveBeenCalled();
  });

  it('resumes at the view live CFI even when the store progress is stale (#4717)', async () => {
    const doc = createDoc('<p>Block zero</p><p>Block one</p><p>Block two</p>');
    const { view } = createMockView([doc], 0);
    // The rAF-debounced store (mockGetProgress) returns null/stale; the view's
    // live lastLocation CFI points at the third paragraph. Resume must follow the
    // live CFI (resolved against the current doc), not fall back to chapter start.
    const thirdParagraph = doc.querySelectorAll('p')[2]!;
    (view as unknown as { lastLocation: { cfi: string } }).lastLocation = { cfi: 'cfi-live' };
    (view.resolveCFI as ReturnType<typeof vi.fn>).mockImplementation((cfi: string) =>
      cfi === 'cfi-live'
        ? {
            index: 0,
            anchor: () => {
              const r = doc.createRange();
              r.selectNodeContents(thirdParagraph);
              return r;
            },
          }
        : null,
    );
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange?.toString()).toContain('Block two');
    });
  });

  it('does not scroll the underlying view when exiting paragraph mode (#4717)', async () => {
    const doc = createDoc('<p>Para A</p><p>Para B</p>');
    const { view, renderer } = createMockView([doc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange).toBeTruthy();
    });

    await act(async () => {
      await hookApi?.toggleParagraphMode();
    });

    expect(renderer.scrollToAnchor).not.toHaveBeenCalled();
  });

  it('still scrolls the underlying view when navigating paragraphs', async () => {
    const doc = createDoc('<p>Para A</p><p>Para B</p><p>Para C</p>');
    const { view, renderer } = createMockView([doc], 0);
    const viewRef = { current: view } as React.RefObject<FoliateView | null>;

    render(<HookHarness view={viewRef} />);
    await waitFor(() => {
      expect(hookApi?.paragraphState.currentRange).toBeTruthy();
    });

    await act(async () => {
      await hookApi?.goToNextParagraph();
    });

    // Navigation to another paragraph must move the underlying view (the goTo
    // runs after a rAF inside focusCurrentParagraph, so wait for it).
    await waitFor(() => {
      expect(renderer.goTo).toHaveBeenCalled();
    });
  });

  it('renders preserved presentation and layout-aware click zones in the overlay', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const overlayBookKey = 'overlay-book';
    const doc = createDoc('<p>مرحبا بالعالم</p>');
    const paragraph = doc.querySelector('p')!;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);

    const { container } = render(
      <ParagraphOverlay
        bookKey={overlayBookKey}
        dimOpacity={0.3}
        viewSettings={{ writingMode: 'horizontal-tb', vertical: false, rtl: true } as never}
      />,
    );

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: overlayBookKey,
        range,
        presentation: {
          lang: 'ja',
          dir: 'ltr',
          writingMode: 'vertical-rl',
          textOrientation: 'upright',
          vertical: true,
          rtl: true,
        },
      });
    });

    const paragraphContent = await waitFor(() => {
      const node = container.querySelector('.paragraph-content') as HTMLDivElement | null;
      expect(node).not.toBeNull();
      return node!;
    });
    expect(paragraphContent.getAttribute('lang')).toBe('ja');
    expect(paragraphContent.style.writingMode).toBe('vertical-rl');
    dispatchSpy.mockClear();

    const contentArea = container.querySelector('.relative.flex') as HTMLDivElement;
    vi.spyOn(contentArea, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    let clickTime = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clickTime);

    fireEvent.click(contentArea, { clientX: 150, clientY: 20 });
    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith('paragraph-prev', { bookKey: overlayBookKey });
    });

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: overlayBookKey,
        range,
        presentation: {
          dir: 'rtl',
          writingMode: 'horizontal-tb',
          vertical: false,
          rtl: true,
        },
      });
    });
    dispatchSpy.mockClear();

    clickTime += 320;

    fireEvent.click(contentArea, { clientX: 40, clientY: 150 });
    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith('paragraph-next', { bookKey: overlayBookKey });
    });
  });

  const renderVisibleOverlay = async (onClose: () => void) => {
    const overlayBookKey = 'overlay-book';
    const doc = createDoc('<p>Hello world</p>');
    const paragraph = doc.querySelector('p')!;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);

    const { container } = render(
      <ParagraphOverlay
        bookKey={overlayBookKey}
        dimOpacity={0.3}
        viewSettings={{ writingMode: 'horizontal-tb', vertical: false, rtl: false } as never}
        onClose={onClose}
      />,
    );

    await act(async () => {
      await eventDispatcher.dispatch('paragraph-focus', {
        bookKey: overlayBookKey,
        range,
        presentation: { dir: 'ltr', writingMode: 'horizontal-tb', vertical: false, rtl: false },
      });
    });

    return { container, overlayBookKey };
  };

  const mockContentRect = (contentArea: HTMLElement) =>
    vi.spyOn(contentArea, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 300,
      top: 0,
      left: 0,
      right: 300,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

  it('reveals the controls instead of exiting when the backdrop is tapped', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const onClose = vi.fn();
    const { container, overlayBookKey } = await renderVisibleOverlay(onClose);

    const dialog = await waitFor(() => {
      const node = container.querySelector('[role="dialog"]') as HTMLDivElement | null;
      expect(node).not.toBeNull();
      return node!;
    });
    dispatchSpy.mockClear();

    fireEvent.click(dialog);

    expect(onClose).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('paragraph-show-controls', {
      bookKey: overlayBookKey,
    });
  });

  it('reveals the controls instead of exiting when the center zone is tapped', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    const onClose = vi.fn();
    const { container, overlayBookKey } = await renderVisibleOverlay(onClose);

    const contentArea = container.querySelector('.relative.flex') as HTMLDivElement;
    mockContentRect(contentArea);
    dispatchSpy.mockClear();

    fireEvent.click(contentArea, { clientX: 150, clientY: 150 });

    expect(onClose).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith('paragraph-show-controls', {
      bookKey: overlayBookKey,
    });
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-next', { bookKey: overlayBookKey });
    expect(dispatchSpy).not.toHaveBeenCalledWith('paragraph-prev', { bookKey: overlayBookKey });
  });

  it('still exits on a double-tap of the paragraph', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);

    const contentArea = container.querySelector('.relative.flex') as HTMLDivElement;
    mockContentRect(contentArea);

    fireEvent.click(contentArea, { clientX: 150, clientY: 150 });
    fireEvent.click(contentArea, { clientX: 150, clientY: 150 });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  const getDialog = (container: HTMLElement) =>
    container.querySelector('[role="dialog"]') as HTMLDivElement;

  it('focuses the dialog when it opens so it receives keys directly (#4717)', async () => {
    const { container } = await renderVisibleOverlay(vi.fn());
    const dialog = getDialog(container);
    expect(document.activeElement).toBe(dialog);
  });

  it('exits when the toggle paragraph mode shortcut (Shift+P) is pressed (#4717)', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);

    fireEvent.keyDown(getDialog(container), { key: 'P', shiftKey: true });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('exits when Escape is pressed on the dialog (#4717)', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);

    fireEvent.keyDown(getDialog(container), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops the toggle key from propagating so it cannot fire twice (#4717)', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);

    fireEvent.keyDown(getDialog(container), { key: 'P', shiftKey: true });

    // The dialog handler must stop propagation so the global useShortcuts
    // handler never receives the same keypress (which would re-toggle).
    expect(windowSpy).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowSpy);
  });

  it('does not exit on an unrelated key while visible', async () => {
    const onClose = vi.fn();
    const { container } = await renderVisibleOverlay(onClose);

    fireEvent.keyDown(getDialog(container), { key: 'x' });

    expect(onClose).not.toHaveBeenCalled();
  });
});
