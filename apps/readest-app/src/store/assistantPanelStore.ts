import { create } from 'zustand';
import { BookNote } from '@/types/book';
import { TextSelection } from '@/utils/sel';

interface AssistantPanelState {
  assistantPanelWidth: string;
  isAssistantPanelVisible: boolean;
  isAssistantPanelPinned: boolean;
  newAnnotation: TextSelection | null;
  // Id of the highlight eagerly created by the "Annotate" action as the anchor
  // for a note in progress. Tracked so a cancelled creation flow can tear that
  // empty placeholder back down instead of leaking it (#4791).
  newHighlightId: string | null;
  editAnnotation: BookNote | null;
  annotationDrafts: { [key: string]: string };
  getIsAssistantPanelVisible: () => boolean;
  toggleAssistantPanel: () => void;
  toggleAssistantPanelPin: () => void;
  getAssistantPanelWidth: () => string;
  setAssistantPanelWidth: (width: string) => void;
  setAssistantPanelVisible: (visible: boolean) => void;
  setAssistantPanelPin: (pinned: boolean) => void;
  setNewAnnotation: (selection: TextSelection | null) => void;
  setNewHighlightId: (id: string | null) => void;
  setEditAnnotation: (note: BookNote | null) => void;
  saveAnnotationDraft: (key: string, note: string) => void;
  getAnnotationDraft: (key: string) => string | undefined;
}

export const useAssistantPanelStore = create<AssistantPanelState>((set, get) => ({
  assistantPanelWidth: '',
  isAssistantPanelVisible: false,
  isAssistantPanelPinned: false,
  newAnnotation: null,
  newHighlightId: null,
  editAnnotation: null,
  annotationDrafts: {},
  getIsAssistantPanelVisible: () => get().isAssistantPanelVisible,
  getAssistantPanelWidth: () => get().assistantPanelWidth,
  setAssistantPanelWidth: (width: string) => set({ assistantPanelWidth: width }),
  toggleAssistantPanel: () =>
    set((state) => ({ isAssistantPanelVisible: !state.isAssistantPanelVisible })),
  toggleAssistantPanelPin: () =>
    set((state) => ({ isAssistantPanelPinned: !state.isAssistantPanelPinned })),
  setAssistantPanelVisible: (visible: boolean) => set({ isAssistantPanelVisible: visible }),
  setAssistantPanelPin: (pinned: boolean) => set({ isAssistantPanelPinned: pinned }),
  setNewAnnotation: (selection: TextSelection | null) => set({ newAnnotation: selection }),
  setNewHighlightId: (id: string | null) => set({ newHighlightId: id }),
  setEditAnnotation: (note: BookNote | null) => set({ editAnnotation: note }),
  saveAnnotationDraft: (key: string, note: string) =>
    set((state) => ({
      annotationDrafts: { ...state.annotationDrafts, [key]: note },
    })),
  getAnnotationDraft: (key: string) => get().annotationDrafts[key],
}));
