import { useCallback } from 'react';
import { useAssistantPanelStore } from '@/store/assistantPanelStore';
import { useReadingAssistantStore } from '@/services/wellread/assistant/readingAssistantStore';

/**
 * Open the Reading Assistant panel.
 * Optionally append a Pending Quote (does not write composer or auto-send).
 */
export function useOpenReadingAssistant() {
  const { setAssistantPanelVisible } = useAssistantPanelStore();
  const setActiveSession = useReadingAssistantStore((s) => s.setActiveSession);
  const appendPendingQuote = useReadingAssistantStore((s) => s.appendPendingQuote);

  const openReadingAssistant = useCallback(
    (options?: {
      sessionId?: string;
      bookId?: string;
      /** Selection text → append as Pending Quote */
      selectionText?: string;
      chapterTitle?: string | null;
    }) => {
      setAssistantPanelVisible(true);

      if (options?.sessionId) {
        setActiveSession(options.sessionId, options.bookId ?? null);
      } else if (options?.bookId) {
        // Reuse the active session for this book when ask-about fires.
        // Otherwise stay session-less — first send creates lazily (same as New chat).
        const state = useReadingAssistantStore.getState();
        if (state.activeSessionId && state.activeBookId === options.bookId) {
          setActiveSession(state.activeSessionId, options.bookId);
        } else {
          setActiveSession(null, options.bookId);
        }
      }

      // Append after session/book update so a book change clear cannot drop this quote.
      if (options?.selectionText) {
        appendPendingQuote({
          text: options.selectionText,
          chapterTitle: options.chapterTitle,
        });
      }
    },
    [setAssistantPanelVisible, setActiveSession, appendPendingQuote],
  );

  return {
    openReadingAssistant,
  };
}

export default useOpenReadingAssistant;
