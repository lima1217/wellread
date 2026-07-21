import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { setAssistantPanelVisible, setActiveSession, appendPendingQuote, createEveSession } =
  vi.hoisted(() => ({
    setAssistantPanelVisible: vi.fn(),
    setActiveSession: vi.fn(),
    appendPendingQuote: vi.fn(),
    createEveSession: vi.fn(),
  }));

vi.mock('@/store/assistantPanelStore', () => ({
  useAssistantPanelStore: () => ({ setAssistantPanelVisible }),
}));

vi.mock('@/services/wellread/assistant/readingAssistantStore', () => ({
  useReadingAssistantStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        setActiveSession,
        appendPendingQuote,
      }),
    {
      getState: () => ({
        activeSessionId: null as string | null,
        activeBookId: null as string | null,
      }),
    },
  ),
}));

vi.mock('@/services/wellread/assistant/eveClient', () => ({
  createEveSession: (...args: unknown[]) => createEveSession(...args),
}));

import { useOpenReadingAssistant } from '@/app/reader/hooks/useOpenReadingAssistant';
import { useReadingAssistantStore } from '@/services/wellread/assistant/readingAssistantStore';

describe('useOpenReadingAssistant', () => {
  beforeEach(() => {
    setAssistantPanelVisible.mockReset();
    setActiveSession.mockReset();
    appendPendingQuote.mockReset();
    createEveSession.mockReset();
    (useReadingAssistantStore as unknown as { getState: () => object }).getState = () => ({
      activeSessionId: null,
      activeBookId: null,
    });
  });

  it('does not create an empty session when opening ask-about without an active chat', () => {
    const { result } = renderHook(() => useOpenReadingAssistant());

    act(() => {
      result.current.openReadingAssistant({
        bookId: 'book-1',
        selectionText: 'vocation',
      });
    });

    expect(createEveSession).not.toHaveBeenCalled();
    expect(setActiveSession).toHaveBeenCalledWith(null, 'book-1');
    expect(appendPendingQuote).toHaveBeenCalledWith({
      text: 'vocation',
      chapterTitle: undefined,
    });
  });

  it('reuses the active session for the same book', () => {
    (useReadingAssistantStore as unknown as { getState: () => object }).getState = () => ({
      activeSessionId: 'ses_live',
      activeBookId: 'book-1',
    });

    const { result } = renderHook(() => useOpenReadingAssistant());

    act(() => {
      result.current.openReadingAssistant({
        bookId: 'book-1',
        selectionText: 'vocation',
      });
    });

    expect(createEveSession).not.toHaveBeenCalled();
    expect(setActiveSession).toHaveBeenCalledWith('ses_live', 'book-1');
  });
});
