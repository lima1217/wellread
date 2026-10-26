import { describe, test, expect, beforeEach } from 'vitest';
import { useAnnotationNoteStore } from '@/store/annotationNoteStore';
import { BookNote } from '@/types/book';
import { TextSelection } from '@/utils/sel';

// Ported from upstream Readest's notebook-store test, trimmed to the
// note-editing state kept for the Reading Assistant panel.
beforeEach(() => {
  useAnnotationNoteStore.setState({
    newAnnotation: null,
    newHighlightId: null,
    editAnnotation: null,
    annotationDrafts: {},
  });
});

describe('annotationNoteStore', () => {
  // ── New annotation ─────────────────────────────────────────────
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
      useAnnotationNoteStore.getState().setNewAnnotation(selection);
      expect(useAnnotationNoteStore.getState().newAnnotation).toEqual(selection);
    });

    test('clears annotation when set to null', () => {
      const selection: TextSelection = {
        key: 'sel-1',
        text: 'test',
        page: 1,
        range: new Range(),
        index: 0,
      };
      useAnnotationNoteStore.getState().setNewAnnotation(selection);
      useAnnotationNoteStore.getState().setNewAnnotation(null);
      expect(useAnnotationNoteStore.getState().newAnnotation).toBeNull();
    });
  });

  // ── New highlight placeholder id ───────────────────────────────
  describe('setNewHighlightId', () => {
    test('tracks the placeholder highlight id', () => {
      useAnnotationNoteStore.getState().setNewHighlightId('hl-1');
      expect(useAnnotationNoteStore.getState().newHighlightId).toBe('hl-1');
    });

    test('clears the placeholder highlight id when set to null', () => {
      useAnnotationNoteStore.getState().setNewHighlightId('hl-1');
      useAnnotationNoteStore.getState().setNewHighlightId(null);
      expect(useAnnotationNoteStore.getState().newHighlightId).toBeNull();
    });
  });

  // ── Edit annotation ────────────────────────────────────────────
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
      useAnnotationNoteStore.getState().setEditAnnotation(note);
      expect(useAnnotationNoteStore.getState().editAnnotation).toEqual(note);
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
      useAnnotationNoteStore.getState().setEditAnnotation(note);
      useAnnotationNoteStore.getState().setEditAnnotation(null);
      expect(useAnnotationNoteStore.getState().editAnnotation).toBeNull();
    });
  });

  // ── Annotation drafts ──────────────────────────────────────────
  describe('saveAnnotationDraft / getAnnotationDraft', () => {
    test('saves and retrieves a draft by key', () => {
      useAnnotationNoteStore.getState().saveAnnotationDraft('note-1', 'Draft text');
      const draft = useAnnotationNoteStore.getState().getAnnotationDraft('note-1');
      expect(draft).toBe('Draft text');
    });

    test('returns undefined for non-existent key', () => {
      const draft = useAnnotationNoteStore.getState().getAnnotationDraft('unknown');
      expect(draft).toBeUndefined();
    });

    test('overwrites existing draft', () => {
      useAnnotationNoteStore.getState().saveAnnotationDraft('note-1', 'First draft');
      useAnnotationNoteStore.getState().saveAnnotationDraft('note-1', 'Updated draft');
      const draft = useAnnotationNoteStore.getState().getAnnotationDraft('note-1');
      expect(draft).toBe('Updated draft');
    });

    test('stores multiple drafts independently', () => {
      useAnnotationNoteStore.getState().saveAnnotationDraft('note-1', 'Draft A');
      useAnnotationNoteStore.getState().saveAnnotationDraft('note-2', 'Draft B');
      expect(useAnnotationNoteStore.getState().getAnnotationDraft('note-1')).toBe('Draft A');
      expect(useAnnotationNoteStore.getState().getAnnotationDraft('note-2')).toBe('Draft B');
    });

    test('preserves existing drafts when adding new ones', () => {
      useAnnotationNoteStore.getState().saveAnnotationDraft('note-1', 'First');
      useAnnotationNoteStore.getState().saveAnnotationDraft('note-2', 'Second');
      useAnnotationNoteStore.getState().saveAnnotationDraft('note-3', 'Third');

      const drafts = useAnnotationNoteStore.getState().annotationDrafts;
      expect(Object.keys(drafts)).toHaveLength(3);
      expect(drafts['note-1']).toBe('First');
      expect(drafts['note-2']).toBe('Second');
      expect(drafts['note-3']).toBe('Third');
    });
  });

  // ── Initial state ──────────────────────────────────────────────
  describe('initial state', () => {
    test('has correct defaults', () => {
      const state = useAnnotationNoteStore.getState();
      expect(state.newAnnotation).toBeNull();
      expect(state.newHighlightId).toBeNull();
      expect(state.editAnnotation).toBeNull();
      expect(state.annotationDrafts).toEqual({});
    });
  });
});
