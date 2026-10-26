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
}));

vi.mock('@/services/wellread/assistant/eveClient', () => ({
  listEveNotes: async () => Object.keys(notes.files),
  readEveNote: async (_bookId: string, path: string) => notes.files[path] ?? '',
  saveEveNote: (...args: unknown[]) => notes.saveEveNote(...args),
}));

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
    notes.saveEveNote.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it('lists notes, opens one without its frontmatter and follows in-package links', async () => {
    render(<AINotesView bookKey='book1-x' />);

    fireEvent.click(await screen.findByText('index.md'));
    fireEvent.click(await screen.findByRole('button', { name: 'Grace' }));

    expect(await screen.findByText('Unmerited favour.')).toBeTruthy();
    expect(screen.queryByText(/type: Concept/)).toBeNull();
  });

  it('edits the raw note and saves it', async () => {
    render(<AINotesView bookKey='book1-x' />);

    fireEvent.click(await screen.findByText('concepts/grace.md'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(editor.value).toContain('type: Concept');

    fireEvent.change(editor, { target: { value: '# Grace\n\nEdited.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(notes.saveEveNote).toHaveBeenCalledWith(
        'book1',
        'concepts/grace.md',
        '# Grace\n\nEdited.',
      ),
    );
    expect(await screen.findByText('Edited.')).toBeTruthy();
  });

  it('shows an empty state when the book has no notes package', async () => {
    notes.files = {};
    render(<AINotesView bookKey='book1-x' />);
    expect(await screen.findByText('No AI notes for this book yet')).toBeTruthy();
  });
});
