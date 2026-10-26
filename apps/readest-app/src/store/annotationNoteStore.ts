import { create } from 'zustand';
import { BookNote } from '@/types/book';
import { TextSelection } from '@/utils/sel';

// Note-editing state restored from upstream Readest's notebook store. The
// panel itself (width / visibility / pin) is the Reading Assistant panel's.
interface AnnotationNoteState {
  newAnnotation: TextSelection | null;
  // Id of the highlight eagerly created by the "Annotate" action as the anchor
  // for a note in progress. Tracked so a cancelled creation flow can tear that
  // empty placeholder back down instead of leaking it (#4791).
  newHighlightId: string | null;
  editAnnotation: BookNote | null;
  annotationDrafts: { [key: string]: string };
  setNewAnnotation: (selection: TextSelection | null) => void;
  setNewHighlightId: (id: string | null) => void;
  setEditAnnotation: (note: BookNote | null) => void;
  saveAnnotationDraft: (key: string, note: string) => void;
  getAnnotationDraft: (key: string) => string | undefined;
}

export const useAnnotationNoteStore = create<AnnotationNoteState>((set, get) => ({
  newAnnotation: null,
  newHighlightId: null,
  editAnnotation: null,
  annotationDrafts: {},
  setNewAnnotation: (selection: TextSelection | null) => set({ newAnnotation: selection }),
  setNewHighlightId: (id: string | null) => set({ newHighlightId: id }),
  setEditAnnotation: (note: BookNote | null) => set({ editAnnotation: note }),
  saveAnnotationDraft: (key: string, note: string) =>
    set((state) => ({
      annotationDrafts: { ...state.annotationDrafts, [key]: note },
    })),
  getAnnotationDraft: (key: string) => get().annotationDrafts[key],
}));
