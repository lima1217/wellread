import type React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { BookNote } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

const { booknotes, jumpToCfi, appendPendingQuote } = vi.hoisted(() => ({
  booknotes: [] as BookNote[],
  jumpToCfi: vi.fn(),
  appendPendingQuote: vi.fn(),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getConfig: () => ({ booknotes }),
    getBookData: () => ({ bookDoc: { toc: [] } }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { customHighlightColors: {} } },
  }),
}));

vi.mock('@/services/wellread/assistant/readingAssistantStore', () => ({
  useReadingAssistantStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ appendPendingQuote }),
}));

vi.mock('@/services/wellread/assistant/readerJump', () => ({
  jumpToCfi: (...args: unknown[]) => jumpToCfi(...args),
}));

const virtuoso = vi.hoisted(() => ({ totalCount: -1 }));

// jsdom has no layout, so the real Virtuoso renders nothing: render every row.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    totalCount,
    itemContent,
  }: {
    totalCount: number;
    itemContent: (index: number) => React.ReactNode;
  }) => {
    virtuoso.totalCount = totalCount;
    return <div>{Array.from({ length: totalCount }, (_, i) => itemContent(i))}</div>;
  },
}));

vi.mock('@/services/nav', () => ({
  findTocItemBS: () => ({ href: 'ch1.xhtml', label: 'Chapter One', id: 1 }),
}));

import { useAnnotationNoteStore } from '@/store/annotationNoteStore';
import AnnotationsView from '@/app/reader/components/assistant/AnnotationsView';

const note = (overrides: Partial<BookNote>): BookNote => ({
  id: 'n',
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
  text: '',
  note: '',
  style: 'highlight',
  color: 'yellow',
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe('AnnotationsView', () => {
  beforeEach(() => {
    booknotes.length = 0;
    jumpToCfi.mockReset();
    appendPendingQuote.mockReset();
  });

  afterEach(() => cleanup());

  it('lists live highlights with the reader note and skips bookmarks and deleted notes', () => {
    booknotes.push(
      note({ id: 'a', text: 'Highlighted passage', note: 'My thought' }),
      note({ id: 'b', text: 'Plain highlight', cfi: 'epubcfi(/6/4!/4/4,/1:0,/1:5)' }),
      note({ id: 'c', text: 'Deleted one', deletedAt: 1 }),
      note({ id: 'd', type: 'bookmark', text: 'Bookmark text' }),
    );
    render(<AnnotationsView bookKey='book-1' onQuote={vi.fn()} />);

    expect(screen.getByText('Chapter One')).toBeTruthy();
    expect(screen.getByText('Highlighted passage')).toBeTruthy();
    expect(screen.getByText('My thought')).toBeTruthy();
    expect(screen.getByText('Plain highlight')).toBeTruthy();
    expect(screen.queryByText('Deleted one')).toBeNull();
    expect(screen.queryByText('Bookmark text')).toBeNull();
  });

  it('renders the chapter header and highlights as rows of a virtualized list', () => {
    booknotes.push(
      note({ id: 'a', text: 'First' }),
      note({ id: 'b', text: 'Second', cfi: 'epubcfi(/6/4!/4/4,/1:0,/1:5)' }),
    );
    render(<AnnotationsView bookKey='book-1' onQuote={vi.fn()} />);

    expect(virtuoso.totalCount).toBe(3);
  });

  it('jumps to a highlight and quotes it into the chat', () => {
    const onQuote = vi.fn();
    booknotes.push(note({ id: 'a', text: 'Highlighted passage', note: 'My thought' }));
    render(<AnnotationsView bookKey='book-1' onQuote={onQuote} />);

    fireEvent.click(screen.getByTitle('Go to highlight'));
    expect(jumpToCfi).toHaveBeenCalledWith('book-1', booknotes[0]!.cfi);

    fireEvent.click(screen.getByRole('button', { name: 'Ask about this' }));
    expect(appendPendingQuote).toHaveBeenCalledWith({
      text: 'Highlighted passage',
      chapterTitle: 'Chapter One',
      cfi: booknotes[0]!.cfi,
    });
    expect(onQuote).toHaveBeenCalled();
  });

  it('opens the note editor for a highlight', () => {
    booknotes.push(note({ id: 'a', text: 'Highlighted passage', note: 'My thought' }));
    render(<AnnotationsView bookKey='book-1' onQuote={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));

    expect(useAnnotationNoteStore.getState().editAnnotation).toMatchObject({
      id: 'a',
      note: 'My thought',
    });
  });

  it('shows an empty state when the book has no highlights', () => {
    render(<AnnotationsView bookKey='book-1' onQuote={vi.fn()} />);
    expect(screen.getByText('No highlights in this book yet')).toBeTruthy();
  });
});
