import { useCallback } from 'react';
import { useNotebookStore } from '@/store/notebookStore';
import { useReadingAssistantStore } from '@/services/wellread/assistant/readingAssistantStore';
import { createEveSession } from '@/services/wellread/assistant/eveClient';

/**
 * Open the notebook Reading Assistant tab.
 * Optionally append a Pending Quote (does not write composer or auto-send).
 */
export function useOpenAIInNotebook() {
  const { setNotebookVisible, setNotebookActiveTab } = useNotebookStore();
  const setActiveSession = useReadingAssistantStore((s) => s.setActiveSession);
  const appendPendingQuote = useReadingAssistantStore((s) => s.appendPendingQuote);

  const openAIInNotebook = useCallback(
    async (options?: {
      sessionId?: string;
      bookId?: string;
      bookTitle?: string;
      newConversationTitle?: string;
      /** Selection text → append as Pending Quote */
      selectionText?: string;
      chapterTitle?: string | null;
    }) => {
      setNotebookVisible(true);
      setNotebookActiveTab('ai');

      if (options?.sessionId) {
        setActiveSession(options.sessionId, options.bookId ?? null);
      } else if (options?.bookId) {
        // Reuse the active session for this book when ask-about fires.
        const state = useReadingAssistantStore.getState();
        if (state.activeSessionId && state.activeBookId === options.bookId) {
          setActiveSession(state.activeSessionId, options.bookId);
        } else {
          const session = await createEveSession({
            bookId: options.bookId,
            bookTitle: options.bookTitle,
            title: options.newConversationTitle,
          });
          setActiveSession(session.id, options.bookId);
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
    [setNotebookVisible, setNotebookActiveTab, setActiveSession, appendPendingQuote],
  );

  return {
    openAIInNotebook,
  };
}

export default useOpenAIInNotebook;
