import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn() },
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ book: { hash: 'book1' } }) }),
}));

vi.mock('@/services/wellread/eveConnectionStore', () => ({
  useEveConnectionStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ ready: true, refresh: vi.fn() }),
}));

vi.mock('@/services/wellread/assistant/readerJump', () => ({ jumpToCfi: vi.fn() }));

const notes = vi.hoisted(() => ({
  files: {} as Record<string, string>,
  saveEveNote: vi.fn(),
  deleteEveNote: vi.fn(),
  ask: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { ask: notes.ask } }),
}));

vi.mock('@/services/wellread/assistant/eveClient', () => {
  class NoteChangedError extends Error {}
  return {
    NoteChangedError,
    listEveNotes: async () => Object.keys(notes.files),
    readEveNote: async (_bookId: string, path: string) => ({
      content: notes.files[path] ?? '',
      mtimeMs: 100,
    }),
    saveEveNote: (...args: unknown[]) => notes.saveEveNote(...args),
    deleteEveNote: (...args: unknown[]) => notes.deleteEveNote(...args),
  };
});

import { NoteChangedError } from '@/services/wellread/assistant/eveClient';

import AINotesView, { resolveNoteLink } from '@/app/reader/components/assistant/AINotesView';

describe('resolveNoteLink', () => {
  it('resolves relative .md links inside the package only', () => {
    expect(resolveNoteLink('concepts/a.md', '../claims/b.md')).toBe('claims/b.md');
    expect(resolveNoteLink('index.md', 'concepts/a.md#x')).toBe('concepts/a.md');
    expect(resolveNoteLink('index.md', '../other/a.md')).toBeNull();
    expect(resolveNoteLink('index.md', 'https://x.test/a.md')).toBeNull();
    expect(resolveNoteLink('index.md', 'notes.txt')).toBeNull();
  });
});

describe('AINotesView', () => {
  beforeEach(() => {
    notes.files = {
      'index.md': '# Package\n\nSee [Grace](concepts/grace.md).',
      'concepts/grace.md': '---\ntype: Concept\ntitle: Grace\n---\n# Grace\n\nUnmerited favour.',
    };
    notes.saveEveNote.mockReset();
    notes.saveEveNote.mockResolvedValue(200);
    notes.deleteEveNote.mockReset();
    notes.deleteEveNote.mockResolvedValue(undefined);
    notes.ask.mockReset();
  });

  afterEach(() => cleanup());

  it('lists notes, opens one without its frontmatter and follows in-package links', async () => {
    render(<AINotesView bookKey='book1-x' />);

    fireEvent.click(await screen.findByText('index.md'));
    fireEvent.click(await screen.findByRole('button', { name: 'Grace' }));

    expect(await screen.findByText('Unmerited favour.')).toBeTruthy();
    expect(screen.queryByText(/type: Concept/)).toBeNull();
  });

  it('edits the body only and saves it back under the original frontmatter', async () => {
    render(<AINotesView bookKey='book1-x' />);

    fireEvent.click(await screen.findByText('concepts/grace.md'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(editor.value).toBe('# Grace\n\nUnmerited favour.');

    fireEvent.change(editor, { target: { value: '# Grace\n\nEdited.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(notes.saveEveNote).toHaveBeenCalledWith(
        'book1',
        'concepts/grace.md',
        '---\ntype: Concept\ntitle: Grace\n---\n# Grace\n\nEdited.',
        100,
      ),
    );
    expect(await screen.findByText('Edited.')).toBeTruthy();
  });

  it('asks before overwriting a page the assistant changed meanwhile', async () => {
    notes.saveEveNote.mockRejectedValueOnce(new NoteChangedError('changed'));
    notes.ask.mockResolvedValueOnce(true);
    render(<AINotesView bookKey='book1-x' />);

    fireEvent.click(await screen.findByText('index.md'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(notes.saveEveNote).toHaveBeenCalledTimes(2));
    expect(notes.ask).toHaveBeenCalled();
    expect(notes.saveEveNote).toHaveBeenLastCalledWith('book1', 'index.md', 'Mine', undefined);
  });

  it('keeps the draft when the reader declines to overwrite', async () => {
    notes.saveEveNote.mockRejectedValueOnce(new NoteChangedError('changed'));
    notes.ask.mockResolvedValueOnce(false);
    render(<AINotesView bookKey='book1-x' />);

    fireEvent.click(await screen.findByText('index.md'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(notes.ask).toHaveBeenCalled());
    expect(notes.saveEveNote).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Mine');
  });

  it('deletes a page after confirmation and returns to the list', async () => {
    notes.ask.mockResolvedValueOnce(true);
    render(<AINotesView bookKey='book1-x' />);

    fireEvent.click(await screen.findByText('concepts/grace.md'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(notes.deleteEveNote).toHaveBeenCalledWith('book1', 'concepts/grace.md'),
    );
    expect(await screen.findByText('index.md')).toBeTruthy();
    expect(screen.queryByText('concepts/grace.md')).toBeNull();
  });

  it('shows an empty state when the book has no notes package', async () => {
    notes.files = {};
    render(<AINotesView bookKey='book1-x' />);
    expect(await screen.findByText('No AI notes for this book yet')).toBeTruthy();
  });
});
