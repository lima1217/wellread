import { useCallback } from 'react';
import { useNotebookStore } from '@/store/notebookStore';
import { useReadingAssistantStore } from '@/services/wellread/assistant/readingAssistantStore';
import { formatAskAboutDraft } from '@/services/wellread/assistant/helpers';
import { createEveSession } from '@/services/wellread/assistant/eveClient';

/**
 * Open the notebook Reading Assistant tab.
 * Optionally prefill an ask-about draft (does not auto-send).
 */
export function useOpenAIInNotebook() {
  const { setNotebookVisible, setNotebookActiveTab } = useNotebookStore();
  const setActiveSession = useReadingAssistantStore((s) => s.setActiveSession);
  const setDraft = useReadingAssistantStore((s) => s.setDraft);

  const openAIInNotebook = useCallback(
    async (options?: {
      sessionId?: string;
      bookId?: string;
      bookTitle?: string;
      newConversationTitle?: string;
      /** Selection text for ask-about prefill */
      selectionText?: string;
      chapterTitle?: string | null;
    }) => {
      setNotebookVisible(true);
      setNotebookActiveTab('ai');

      if (options?.selectionText) {
        setDraft(
          formatAskAboutDraft({
            text: options.selectionText,
            chapterTitle: options.chapterTitle,
          }),
        );
      }

      if (options?.sessionId) {
        setActiveSession(options.sessionId, options.bookId ?? null);
        return;
      }

      if (!options?.bookId) return;

      // Reuse the active session for this book when ask-about fires.
      const state = useReadingAssistantStore.getState();
      if (state.activeSessionId && state.activeBookId === options.bookId) {
        setActiveSession(state.activeSessionId, options.bookId);
        return;
      }

      const session = await createEveSession({
        bookId: options.bookId,
        bookTitle: options.bookTitle,
        title: options.newConversationTitle,
      });
      setActiveSession(session.id, options.bookId);
    },
    [setNotebookVisible, setNotebookActiveTab, setActiveSession, setDraft],
  );

  const closeAIInNotebook = useCallback(() => {
    setNotebookActiveTab('notes');
  }, [setNotebookActiveTab]);

  return {
    openAIInNotebook,
    closeAIInNotebook,
  };
}

export default useOpenAIInNotebook;
