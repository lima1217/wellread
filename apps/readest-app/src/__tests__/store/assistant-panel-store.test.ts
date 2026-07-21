import { describe, test, expect, beforeEach } from 'vitest';
import { useAssistantPanelStore } from '@/store/assistantPanelStore';
import { BookNote } from '@/types/book';
import { TextSelection } from '@/utils/sel';

beforeEach(() => {
  useAssistantPanelStore.setState({
    assistantPanelWidth: '',
    isAssistantPanelVisible: false,
    isAssistantPanelPinned: false,
    newAnnotation: null,
    newHighlightId: null,
    editAnnotation: null,
    annotationDrafts: {},
  });
});

describe('assistantPanelStore', () => {
  describe('toggleAssistantPanel', () => {
    test('toggles visibility from false to true', () => {
      useAssistantPanelStore.getState().toggleAssistantPanel();
      expect(useAssistantPanelStore.getState().isAssistantPanelVisible).toBe(true);
    });

    test('toggles visibility from true to false', () => {
      useAssistantPanelStore.getState().setAssistantPanelVisible(true);
      useAssistantPanelStore.getState().toggleAssistantPanel();
      expect(useAssistantPanelStore.getState().isAssistantPanelVisible).toBe(false);
    });
  });

  describe('setAssistantPanelVisible', () => {
    test('sets visibility to true', () => {
      useAssistantPanelStore.getState().setAssistantPanelVisible(true);
      expect(useAssistantPanelStore.getState().isAssistantPanelVisible).toBe(true);
    });

    test('sets visibility to false', () => {
      useAssistantPanelStore.getState().setAssistantPanelVisible(true);
      useAssistantPanelStore.getState().setAssistantPanelVisible(false);
      expect(useAssistantPanelStore.getState().isAssistantPanelVisible).toBe(false);
    });
  });

  describe('getIsAssistantPanelVisible', () => {
    test('returns current visibility', () => {
      expect(useAssistantPanelStore.getState().getIsAssistantPanelVisible()).toBe(false);
      useAssistantPanelStore.getState().setAssistantPanelVisible(true);
      expect(useAssistantPanelStore.getState().getIsAssistantPanelVisible()).toBe(true);
    });
  });

  describe('toggleAssistantPanelPin', () => {
    test('toggles pin from false to true', () => {
      useAssistantPanelStore.getState().toggleAssistantPanelPin();
      expect(useAssistantPanelStore.getState().isAssistantPanelPinned).toBe(true);
    });

    test('toggles pin from true to false', () => {
      useAssistantPanelStore.getState().setAssistantPanelPin(true);
      useAssistantPanelStore.getState().toggleAssistantPanelPin();
      expect(useAssistantPanelStore.getState().isAssistantPanelPinned).toBe(false);
    });
  });

  describe('setAssistantPanelPin', () => {
    test('sets pinned to true', () => {
      useAssistantPanelStore.getState().setAssistantPanelPin(true);
      expect(useAssistantPanelStore.getState().isAssistantPanelPinned).toBe(true);
    });

    test('sets pinned to false', () => {
      useAssistantPanelStore.getState().setAssistantPanelPin(true);
      useAssistantPanelStore.getState().setAssistantPanelPin(false);
      expect(useAssistantPanelStore.getState().isAssistantPanelPinned).toBe(false);
    });
  });

  describe('setAssistantPanelWidth / getAssistantPanelWidth', () => {
    test('sets and gets width', () => {
      useAssistantPanelStore.getState().setAssistantPanelWidth('400px');
      expect(useAssistantPanelStore.getState().getAssistantPanelWidth()).toBe('400px');
    });

    test('defaults to empty string', () => {
      expect(useAssistantPanelStore.getState().getAssistantPanelWidth()).toBe('');
    });
  });

  describe('setNewAnnotation', () => {
    test('sets a new annotation selection', () => {
      const selection: TextSelection = {
        key: 'sel-1',
        text: 'Hello world',
        page: 1,
        range: new Range(),
        index: 0,
        cfi: 'epubcfi(/6/2!/4/1:0)',
      };
      useAssistantPanelStore.getState().setNewAnnotation(selection);
      expect(useAssistantPanelStore.getState().newAnnotation).toEqual(selection);
    });

    test('clears annotation when set to null', () => {
      const selection: TextSelection = {
        key: 'sel-1',
        text: 'test',
        page: 1,
        range: new Range(),
        index: 0,
      };
      useAssistantPanelStore.getState().setNewAnnotation(selection);
      useAssistantPanelStore.getState().setNewAnnotation(null);
      expect(useAssistantPanelStore.getState().newAnnotation).toBeNull();
    });
  });

  describe('setNewHighlightId', () => {
    test('tracks the placeholder highlight id', () => {
      useAssistantPanelStore.getState().setNewHighlightId('hl-1');
      expect(useAssistantPanelStore.getState().newHighlightId).toBe('hl-1');
    });

    test('clears the placeholder highlight id when set to null', () => {
      useAssistantPanelStore.getState().setNewHighlightId('hl-1');
      useAssistantPanelStore.getState().setNewHighlightId(null);
      expect(useAssistantPanelStore.getState().newHighlightId).toBeNull();
    });
  });

  describe('setEditAnnotation', () => {
    test('sets a note for editing', () => {
      const note: BookNote = {
        id: 'note-1',
        type: 'annotation',
        cfi: 'epubcfi(/6/2)',
        note: 'My annotation',
        createdAt: 1000,
        updatedAt: 2000,
      };
      useAssistantPanelStore.getState().setEditAnnotation(note);
      expect(useAssistantPanelStore.getState().editAnnotation).toEqual(note);
    });

    test('clears edit annotation when set to null', () => {
      const note: BookNote = {
        id: 'note-1',
        type: 'bookmark',
        cfi: 'cfi',
        note: 'test',
        createdAt: 1000,
        updatedAt: 1000,
      };
      useAssistantPanelStore.getState().setEditAnnotation(note);
      useAssistantPanelStore.getState().setEditAnnotation(null);
      expect(useAssistantPanelStore.getState().editAnnotation).toBeNull();
    });
  });

  describe('saveAnnotationDraft / getAnnotationDraft', () => {
    test('saves and retrieves a draft by key', () => {
      useAssistantPanelStore.getState().saveAnnotationDraft('note-1', 'Draft text');
      const draft = useAssistantPanelStore.getState().getAnnotationDraft('note-1');
      expect(draft).toBe('Draft text');
    });

    test('returns undefined for non-existent key', () => {
      const draft = useAssistantPanelStore.getState().getAnnotationDraft('unknown');
      expect(draft).toBeUndefined();
    });

    test('overwrites existing draft', () => {
      useAssistantPanelStore.getState().saveAnnotationDraft('note-1', 'First draft');
      useAssistantPanelStore.getState().saveAnnotationDraft('note-1', 'Updated draft');
      const draft = useAssistantPanelStore.getState().getAnnotationDraft('note-1');
      expect(draft).toBe('Updated draft');
    });

    test('stores multiple drafts independently', () => {
      useAssistantPanelStore.getState().saveAnnotationDraft('note-1', 'Draft A');
      useAssistantPanelStore.getState().saveAnnotationDraft('note-2', 'Draft B');
      expect(useAssistantPanelStore.getState().getAnnotationDraft('note-1')).toBe('Draft A');
      expect(useAssistantPanelStore.getState().getAnnotationDraft('note-2')).toBe('Draft B');
    });

    test('preserves existing drafts when adding new ones', () => {
      useAssistantPanelStore.getState().saveAnnotationDraft('note-1', 'First');
      useAssistantPanelStore.getState().saveAnnotationDraft('note-2', 'Second');
      useAssistantPanelStore.getState().saveAnnotationDraft('note-3', 'Third');

      const drafts = useAssistantPanelStore.getState().annotationDrafts;
      expect(Object.keys(drafts)).toHaveLength(3);
      expect(drafts['note-1']).toBe('First');
      expect(drafts['note-2']).toBe('Second');
      expect(drafts['note-3']).toBe('Third');
    });
  });

  describe('initial state', () => {
    test('has correct defaults', () => {
      const state = useAssistantPanelStore.getState();
      expect(state.assistantPanelWidth).toBe('');
      expect(state.isAssistantPanelVisible).toBe(false);
      expect(state.isAssistantPanelPinned).toBe(false);
      expect(state.newAnnotation).toBeNull();
      expect(state.newHighlightId).toBeNull();
      expect(state.editAnnotation).toBeNull();
      expect(state.annotationDrafts).toEqual({});
    });
  });
});
