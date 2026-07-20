/**
 * Zustand store for Reading Assistant UI state (active session + ask-about draft).
 * Session persistence lives in the eve sidecar under EVE_DATA_DIR.
 */

import { create } from 'zustand';

type ReadingAssistantState = {
  activeSessionId: string | null;
  /** bookId that activeSessionId belongs to */
  activeBookId: string | null;
  /** Prefill for composer (ask-about); not auto-sent. */
  draft: string;
  setActiveSession: (sessionId: string | null, bookId?: string | null) => void;
  setDraft: (draft: string) => void;
  clearDraft: () => void;
};

export const useReadingAssistantStore = create<ReadingAssistantState>((set) => ({
  activeSessionId: null,
  activeBookId: null,
  draft: '',
  setActiveSession: (sessionId, bookId = null) =>
    set({
      activeSessionId: sessionId,
      activeBookId: bookId ?? null,
    }),
  setDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: '' }),
}));
