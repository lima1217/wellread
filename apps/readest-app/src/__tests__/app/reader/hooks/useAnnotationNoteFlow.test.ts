import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { BookNote } from '@/types/book';
import type { TextSelection } from '@/utils/sel';
import { NOTE_PREFIX } from '@/types/view';

const h = vi.hoisted(() => ({
  booknotes: [] as BookNote[],
  view: { getCFI: vi.fn(), addAnnotation: vi.fn() },
  saveConfig: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));

vi.mock('@/store/settingsStore', () => {
  const settings = {
    globalReadSettings: { highlightStyle: 'highlight', highlightStyles: { highlight: 'yellow' } },
  };
  return {
    useSettingsStore: Object.assign(() => ({ settings }), { getState: () => ({ settings }) }),
  };
});

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({ booknotes: h.booknotes }),
    updateBooknotes: (_key: string, booknotes: BookNote[]) => ({ booknotes }),
    saveConfig: h.saveConfig,
  }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewsById: () => [h.view],
    getProgress: () => ({ page: 7 }),
  }),
}));

import { useNotebookStore } from '@/store/notebookStore';
import { useAnnotationNoteFlow } from '@/app/reader/hooks/useAnnotationNoteFlow';

const CFI = 'epubcfi(/6/4!/4/2,/1:0,/1:5)';
const selection = { key: 's', text: 'Hello', page: 3, index: 0, range: {} } as TextSelection;
const highlight = (over: Partial<BookNote> = {}): BookNote => ({
  id: 'hl-1',
  type: 'annotation',
  cfi: CFI,
  style: 'highlight',
  color: 'yellow',
  text: 'Hello',
  note: '',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('useAnnotationNoteFlow', () => {
  beforeEach(() => {
    h.booknotes = [];
    h.view.getCFI.mockReset().mockReturnValue(CFI);
    h.view.addAnnotation.mockReset();
    h.saveConfig.mockReset();
    useNotebookStore.setState({
      notebookNewAnnotation: selection,
      notebookNewHighlightId: 'hl-1',
      notebookEditAnnotation: null,
    });
  });

  it('attaches a saved note to the highlight at the selection and draws its bubble', () => {
    h.booknotes.push(highlight());
    const { result } = renderHook(() => useAnnotationNoteFlow('book-1'));

    result.current.handleSaveNote(selection, 'My thought');

    expect(h.booknotes).toHaveLength(1);
    expect(h.booknotes[0]!.note).toBe('My thought');
    expect(h.view.addAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ value: `${NOTE_PREFIX}${CFI}`, note: 'My thought' }),
    );
    expect(h.saveConfig).toHaveBeenCalled();
    expect(useNotebookStore.getState().notebookNewAnnotation).toBeNull();
    expect(useNotebookStore.getState().notebookNewHighlightId).toBeNull();
  });

  it('creates a highlighted note when nothing is highlighted at the selection yet', () => {
    const { result } = renderHook(() => useAnnotationNoteFlow('book-1'));

    result.current.handleSaveNote(selection, 'Fresh note');

    expect(h.booknotes).toEqual([
      expect.objectContaining({ cfi: CFI, note: 'Fresh note', style: 'highlight', text: 'Hello' }),
    ]);
  });

  it('tears down the empty placeholder highlight when the note is cancelled', () => {
    h.booknotes.push(highlight());
    const { result } = renderHook(() => useAnnotationNoteFlow('book-1'));

    result.current.handleCancelNewAnnotation('book-1');

    expect(h.booknotes[0]!.deletedAt).toBeTruthy();
    expect(h.view.addAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ value: CFI }),
      true,
    );
    expect(useNotebookStore.getState().notebookNewAnnotation).toBeNull();
  });

  it('keeps a highlight that already carries a note when cancelling', () => {
    h.booknotes.push(highlight({ note: 'kept' }));
    const { result } = renderHook(() => useAnnotationNoteFlow('book-1'));

    result.current.handleCancelNewAnnotation('book-1');

    expect(h.booknotes[0]!.deletedAt).toBeUndefined();
  });

  it('saves an edited note on an existing highlight', () => {
    const existing = highlight({ note: 'old' });
    h.booknotes.push(existing);
    useNotebookStore.setState({ notebookNewAnnotation: null, notebookEditAnnotation: existing });
    const { result } = renderHook(() => useAnnotationNoteFlow('book-1'));

    result.current.handleEditNote({ ...existing, note: 'new' }, false);

    expect(h.booknotes[0]!.note).toBe('new');
    expect(h.saveConfig).toHaveBeenCalled();
    expect(useNotebookStore.getState().notebookEditAnnotation).toBeNull();
  });
});
