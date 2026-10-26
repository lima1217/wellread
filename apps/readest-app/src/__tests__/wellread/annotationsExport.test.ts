import { describe, expect, it, vi } from 'vitest';
import type { BookNote } from '@/types/book';
import {
  annotationsExportPath,
  exportBookAnnotations,
  formatAnnotationsMarkdown,
} from '@/services/wellread/assistant/annotationsExport';

const note = (over: Partial<BookNote>): BookNote => ({
  id: 'n',
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4/2/1:0)',
  note: '',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('formatAnnotationsMarkdown', () => {
  it('writes one ### block per live item in reading order', () => {
    const md = formatAnnotationsMarkdown(
      [
        note({ id: 'b', cfi: 'epubcfi(/6/6!/4/2/1:0)', text: 'Later\nline', note: 'mine' }),
        note({ id: 'a', text: 'Call me Ishmael.' }),
        note({ id: 'gone', text: 'deleted', deletedAt: 5 }),
        note({ id: 'm', type: 'bookmark', cfi: 'epubcfi(/6/4!/4/8/1:0)' }),
      ],
      { bookTitle: 'Moby', getChapterTitle: (i) => (i === 1 ? 'Loomings' : null) },
    );
    expect(md).toBe(
      [
        '# Reader annotations: Moby',
        '',
        '### Highlight · Loomings',
        'cfi: epubcfi(/6/4!/4/2/1:0)',
        '> Call me Ishmael.',
        '',
        '### Bookmark · Loomings',
        'cfi: epubcfi(/6/4!/4/8/1:0)',
        '',
        '### Note · Section 3',
        'cfi: epubcfi(/6/6!/4/2/1:0)',
        '> Later line',
        'Note: mine',
        '',
      ].join('\n'),
    );
  });

  it('is empty when there is nothing to share', () => {
    expect(formatAnnotationsMarkdown([], { bookTitle: 'x' })).toBe('');
  });
});

describe('exportBookAnnotations', () => {
  it('skips the write when content is unchanged', async () => {
    const writeText = vi.fn(async (_path: string, _content: string) => {});
    const input = {
      fs: { writeText },
      bookId: 'bk-export',
      bookTitle: 'Moby',
      booknotes: [note({ text: 'hi' })],
    };
    await exportBookAnnotations(input);
    await exportBookAnnotations(input);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toBe(annotationsExportPath('bk-export'));
  });
});
