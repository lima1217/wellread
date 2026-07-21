import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * Regression: opening Chat History must not unmount the chat host.
 * In-progress streaming lives in useEveAgent React state; unmounting drops it,
 * so returning to the same session rehydrates from disk without the live turn.
 */
const chatLifecycle = { mounts: 0, unmounts: 0 };

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
}));

vi.mock('@/hooks/useShortcuts', () => ({
  default: () => {},
}));

vi.mock('@/hooks/useSwipeToDismiss', () => ({
  useSwipeToDismiss: () => ({
    panelRef: { current: null },
    overlayRef: { current: null },
    panelHeight: '50%',
    handleVerticalDragStart: vi.fn(),
  }),
}));

vi.mock('@/hooks/usePanelResize', () => ({
  usePanelResize: () => ({
    handleResizeStart: vi.fn(),
    handleResizeKeyDown: vi.fn(),
  }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: { hasRoundedWindow: false, isMobile: false },
  }),
}));

vi.mock('@/helpers/settings', () => ({
  saveSysSettings: vi.fn(),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { on: vi.fn(), off: vi.fn(), dispatch: vi.fn() },
}));

vi.mock('@/components/Overlay', () => ({
  Overlay: () => null,
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: {
        assistantPanelWidth: '30%',
        isAssistantPanelPinned: true,
      },
    },
  }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({
    updateAppTheme: vi.fn(),
    safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
    systemUIVisible: false,
    statusBarHeight: 0,
  }),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ sideBarBookKey: 'book-1' }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({
      book: { hash: 'book-1', title: 'Middlemarch' },
      bookDoc: { metadata: { language: 'en' } },
    }),
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getViewSettings: () => ({ isEink: false }),
  }),
}));

vi.mock('@/store/assistantPanelStore', () => ({
  useAssistantPanelStore: Object.assign(
    () => ({
      assistantPanelWidth: '30%',
      isAssistantPanelVisible: true,
      isAssistantPanelPinned: true,
      setAssistantPanelPin: vi.fn(),
      getAssistantPanelWidth: () => '30%',
      setAssistantPanelWidth: vi.fn(),
      setAssistantPanelVisible: vi.fn(),
      toggleAssistantPanelPin: vi.fn(),
    }),
    {
      getState: () => ({ isAssistantPanelPinned: true }),
    },
  ),
}));

const { setActiveSession, clearPendingQuotes, createEveSession } = vi.hoisted(() => ({
  setActiveSession: vi.fn(),
  clearPendingQuotes: vi.fn(),
  createEveSession: vi.fn(),
}));

vi.mock('@/services/wellread/assistant/readingAssistantStore', () => ({
  useReadingAssistantStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      activeSessionId: 'ses_1',
      setActiveSession,
      clearPendingQuotes,
    }),
}));

vi.mock('@/services/wellread/assistant/eveClient', () => ({
  createEveSession: (...args: unknown[]) => createEveSession(...args),
}));

vi.mock('@/app/reader/components/assistant/AIAssistant', () => ({
  default: function MockAIAssistant() {
    React.useEffect(() => {
      chatLifecycle.mounts += 1;
      return () => {
        chatLifecycle.unmounts += 1;
      };
    }, []);
    return <div data-testid='ai-assistant'>AI chat</div>;
  },
}));

vi.mock('@/app/reader/components/sidebar/ChatHistoryView', () => ({
  default: function MockChatHistory() {
    return <div data-testid='chat-history'>History</div>;
  },
}));

import AssistantPanel from '@/app/reader/components/assistant/AssistantPanel';

describe('AssistantPanel chat↔history pane', () => {
  beforeEach(() => {
    chatLifecycle.mounts = 0;
    chatLifecycle.unmounts = 0;
    setActiveSession.mockReset();
    clearPendingQuotes.mockReset();
    createEveSession.mockReset();
  });

  afterEach(() => cleanup());

  it('keeps AIAssistant mounted when opening Chat History', () => {
    render(<AssistantPanel />);

    expect(screen.getByTestId('ai-assistant')).toBeTruthy();
    expect(chatLifecycle.mounts).toBe(1);
    expect(chatLifecycle.unmounts).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Chat History' }));

    expect(screen.getByTestId('chat-history')).toBeTruthy();
    expect(screen.getByTestId('ai-assistant')).toBeTruthy();
    expect(chatLifecycle.unmounts).toBe(0);
    expect(chatLifecycle.mounts).toBe(1);
  });

  it('New chat clears the active session without creating an empty sidecar row', async () => {
    render(<AssistantPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));

    await Promise.resolve();

    expect(createEveSession).not.toHaveBeenCalled();
    expect(clearPendingQuotes).toHaveBeenCalled();
    expect(setActiveSession).toHaveBeenCalledWith(null, 'book-1');
    expect(setActiveSession).toHaveBeenCalledTimes(2);
  });
});
