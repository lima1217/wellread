import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { BookNote } from '@/types/book';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { customHighlightColors: {} } },
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getConfig: vi.fn(), saveConfig: vi.fn(), updateBooknotes: vi.fn() }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getProgress: () => null,
    getView: () => null,
    getViewsById: () => [],
    getViewSettings: () => null,
  }),
}));

import BooknoteItem from '@/app/reader/components/sidebar/BooknoteItem';

afterEach(cleanup);

const note = (text: string): BookNote => ({
  id: 'n1',
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
  text: 'Highlighted',
  note: text,
  style: 'highlight',
  color: 'yellow',
  createdAt: 1,
  updatedAt: 1,
});

describe('BooknoteItem note rendering', () => {
  it('sanitizes note HTML, which can come from imported annotations', () => {
    const { container } = render(
      <BooknoteItem
        bookKey='book-1'
        item={note(
          '**kept** <img src="x" onerror="alert(1)"><a href="javascript:alert(1)">link</a><iframe srcdoc="evil"></iframe>',
        )}
      />,
    );
    const body = container.querySelector('.prose')!;
    expect(body.querySelector('strong')?.textContent).toBe('kept');
    expect(body.querySelector('img')?.hasAttribute('onerror')).toBe(false);
    expect(body.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(body.querySelector('iframe')).toBeNull();
  });
});
