import { create } from 'zustand';
import { BookNote } from '@/types/book';
import { TextSelection } from '@/utils/sel';

// Note-editing state restored from upstream Readest's notebook store. The
// panel itself (width / visibility / pin) is the Reading Assistant panel's.
interface NotebookState {
  notebookNewAnnotation: TextSelection | null;
  // Id of the highlight eagerly created by the "Annotate" action as the anchor
  // for a note in progress. Tracked so a cancelled creation flow can tear that
  // empty placeholder back down instead of leaking it (#4791).
  notebookNewHighlightId: string | null;
  notebookEditAnnotation: BookNote | null;
  notebookAnnotationDrafts: { [key: string]: string };
  setNotebookNewAnnotation: (selection: TextSelection | null) => void;
  setNotebookNewHighlightId: (id: string | null) => void;
  setNotebookEditAnnotation: (note: BookNote | null) => void;
  saveNotebookAnnotationDraft: (key: string, note: string) => void;
  getNotebookAnnotationDraft: (key: string) => string | undefined;
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  notebookNewAnnotation: null,
  notebookNewHighlightId: null,
  notebookEditAnnotation: null,
  notebookAnnotationDrafts: {},
  setNotebookNewAnnotation: (selection: TextSelection | null) =>
    set({ notebookNewAnnotation: selection }),
  setNotebookNewHighlightId: (id: string | null) => set({ notebookNewHighlightId: id }),
  setNotebookEditAnnotation: (note: BookNote | null) => set({ notebookEditAnnotation: note }),
  saveNotebookAnnotationDraft: (key: string, note: string) =>
    set((state) => ({
      notebookAnnotationDrafts: { ...state.notebookAnnotationDrafts, [key]: note },
    })),
  getNotebookAnnotationDraft: (key: string) => get().notebookAnnotationDrafts[key],
}));
