/**
 * Zustand store for Reading Assistant UI state (active session + Pending Quotes).
 * Session persistence lives in the eve sidecar under EVE_DATA_DIR.
 */

import { create } from 'zustand';
import type { PendingQuoteForTurn } from '@wellread/quote-wire';
import { uniqueId } from '@/utils/misc';

/** Live bar quote: wire shape plus store id (chapterTitle normalized to null). */
export type PendingQuote = PendingQuoteForTurn & { id: string; chapterTitle: string | null };

export type PendingQuoteInput = PendingQuoteForTurn;

type ReadingAssistantState = {
  activeSessionId: string | null;
  /** bookId that activeSessionId belongs to */
  activeBookId: string | null;
  /** Snapshots queued for the next send (Ask about this). Not mirrored from live selection. */
  pendingQuotes: PendingQuote[];
  setActiveSession: (sessionId: string | null, bookId?: string | null) => void;
  appendPendingQuote: (input: PendingQuoteInput) => void;
  removePendingQuote: (id: string) => void;
  clearPendingQuotes: () => void;
  /** Put quotes back on the live bar (e.g. after a failed send). */
  restorePendingQuotes: (quotes: PendingQuote[]) => void;
};

export const useReadingAssistantStore = create<ReadingAssistantState>((set) => ({
  activeSessionId: null,
  activeBookId: null,
  pendingQuotes: [],
  setActiveSession: (sessionId, bookId = null) =>
    set((state) => {
      const nextBookId = bookId ?? null;
      const bookChanged =
        nextBookId !== null && state.activeBookId !== null && nextBookId !== state.activeBookId;
      return {
        activeSessionId: sessionId,
        activeBookId: nextBookId,
        ...(bookChanged ? { pendingQuotes: [] } : {}),
      };
    }),
  appendPendingQuote: (input) => {
    const text = input.text.trim();
    if (!text) return;
    set((state) => ({
      pendingQuotes: [
        ...state.pendingQuotes,
        {
          id: uniqueId(),
          text,
          chapterTitle: input.chapterTitle?.trim() || null,
        },
      ],
    }));
  },
  removePendingQuote: (id) =>
    set((state) => ({
      pendingQuotes: state.pendingQuotes.filter((q) => q.id !== id),
    })),
  clearPendingQuotes: () => set({ pendingQuotes: [] }),
  restorePendingQuotes: (quotes) => set({ pendingQuotes: quotes }),
}));
