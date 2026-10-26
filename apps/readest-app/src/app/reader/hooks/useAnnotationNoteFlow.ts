import { useCallback } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useAnnotationNoteStore } from '@/store/annotationNoteStore';
import { BookNote } from '@/types/book';
import { NOTE_PREFIX } from '@/types/view';
import { TextSelection } from '@/utils/sel';
import { uniqueId } from '@/utils/misc';
import {
  findAnnotationAtCfi,
  removeBookNoteOverlays,
  removeEmptyAnnotationPlaceholder,
} from '../utils/annotatorUtil';

/**
 * Save / edit / cancel for the reader's own highlight notes, restored from
 * upstream Readest's Notebook panel (now hosted in the Reading Assistant panel).
 */
export function useAnnotationNoteFlow(bookKey: string | null) {
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getView, getViewsById, getProgress } = useReaderStore();
  const { setNewAnnotation, setNewHighlightId, setEditAnnotation } = useAnnotationNoteStore();

  // Abandon a note-creation flow: tear down the empty highlight the "Annotate"
  // action eagerly created as the note anchor so it doesn't leak into the
  // booknotes list (#4791). A saved note carries text, so it survives the guard
  // in removeEmptyAnnotationPlaceholder; a restyled pre-existing highlight has no
  // tracked id and is left alone. `bookKey` is passed explicitly so the unmount/
  // book-switch cleanup targets the book the placeholder belongs to.
  const handleCancelNewAnnotation = useCallback(
    (bookKey: string | null) => {
      const { newHighlightId } = useAnnotationNoteStore.getState();
      if (bookKey && newHighlightId) {
        const config = getConfig(bookKey);
        const { booknotes: annotations = [] } = config || {};
        const placeholder = removeEmptyAnnotationPlaceholder(
          annotations,
          newHighlightId,
          Date.now(),
        );
        if (placeholder) {
          const views = getViewsById(bookKey.split('-')[0]!);
          views.forEach((view) => removeBookNoteOverlays(view, placeholder));
          const updatedConfig = updateBooknotes(bookKey, annotations);
          if (updatedConfig) {
            // Read settings fresh: this callback has stable identity (empty deps)
            // so a captured `settings` would go stale across saves.
            saveConfig(envConfig, bookKey, updatedConfig, useSettingsStore.getState().settings);
          }
        }
      }
      setNewHighlightId(null);
      setNewAnnotation(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleSaveNote = (selection: TextSelection, note: string) => {
    if (!bookKey) return;
    const view = getView(bookKey);
    const config = getConfig(bookKey)!;

    const cfi = view?.getCFI(selection.index, selection.range);
    if (!cfi) return;

    const { booknotes: annotations = [] } = config;
    const existingIndex = findAnnotationAtCfi(annotations, cfi);
    if (existingIndex !== -1) {
      // Attach the note to the existing highlight at this CFI instead of
      // creating a second record. The highlight overlay (value = cfi) already
      // exists; add the note bubble overlay (value = NOTE_PREFIX+cfi).
      const existing = annotations[existingIndex]!;
      const updated: BookNote = {
        ...existing,
        note,
        text: selection.text || existing.text,
        updatedAt: Date.now(),
      };
      annotations[existingIndex] = updated;
      view?.addAnnotation({ ...updated, value: `${NOTE_PREFIX}${updated.cfi}` });
    } else {
      // No highlight at this CFI yet (e.g. a note added without first
      // highlighting): create one unified record with the current global style
      // so the note still shows an underlying highlight, and draw both overlays.
      const style = settings.globalReadSettings.highlightStyle;
      const color = settings.globalReadSettings.highlightStyles[style];
      const annotation: BookNote = {
        id: uniqueId(),
        type: 'annotation',
        cfi,
        style,
        color,
        note,
        page: selection.page,
        text: selection.text,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      view?.addAnnotation(annotation);
      view?.addAnnotation({ ...annotation, value: `${NOTE_PREFIX}${annotation.cfi}` });
      annotations.push(annotation);
    }
    const updatedConfig = updateBooknotes(bookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
    setNewAnnotation(null);
    // The placeholder now carries a note (or a fresh unified record was created),
    // so it's a real annotation — drop the cancel-cleanup handle (#4791).
    setNewHighlightId(null);
  };

  const handleEditNote = (note: BookNote, isDelete: boolean) => {
    if (!bookKey) return;
    const view = getView(bookKey);
    const config = getConfig(bookKey)!;
    const progress = getProgress(bookKey)!;
    const { booknotes: annotations = [] } = config;
    const existingIndex = annotations.findIndex((item) => item.id === note.id);
    if (existingIndex === -1) return;
    if (isDelete) {
      note.deletedAt = Date.now();
    } else {
      note.updatedAt = Date.now();
    }
    note.page = progress.page;
    annotations[existingIndex] = note;
    view?.addAnnotation({ ...note, value: `${NOTE_PREFIX}${note.cfi}` }, true);
    const updatedConfig = updateBooknotes(bookKey, annotations);
    if (updatedConfig) {
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    }
    setEditAnnotation(null);
  };

  return { handleSaveNote, handleEditNote, handleCancelNewAnnotation };
}
