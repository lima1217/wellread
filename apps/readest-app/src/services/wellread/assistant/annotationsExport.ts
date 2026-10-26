/**
 * Export the current book's highlights / notes / bookmarks for the Reading
 * Assistant to `Books/.wellread/annotations/<bookId>.md`. The sidecar
 * advertises the file in <reading_context>; the model reads it on demand.
 * One `### ` block per item (the sidecar counts them).
 */

import * as CFI from 'foliate-js/epubcfi.js';
import type { BookNote } from '@/types/book';
import { getIndexFromCfi } from '@/utils/cfi';

export const annotationsExportPath = (bookId: string) => `.wellread/annotations/${bookId}.md`;

const TYPE_LABEL: Record<BookNote['type'], string> = {
  annotation: 'Highlight',
  excerpt: 'Excerpt',
  bookmark: 'Bookmark',
};

function compareCfi(a: string, b: string): number {
  try {
    return CFI.compare(a, b);
  } catch {
    return a.localeCompare(b);
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function formatAnnotationsMarkdown(
  booknotes: BookNote[],
  options: { bookTitle: string; getChapterTitle?: (sectionIndex: number) => string | null },
): string {
  const live = booknotes
    .filter((n) => !n.deletedAt && n.cfi)
    .sort((a, b) => compareCfi(a.cfi, b.cfi));
  if (!live.length) return '';
  const lines = [`# Reader annotations: ${oneLine(options.bookTitle)}`, ''];
  for (const n of live) {
    const sectionIndex = getIndexFromCfi(n.cfi);
    const chapter =
      sectionIndex !== null
        ? (options.getChapterTitle?.(sectionIndex) ?? `Section ${sectionIndex + 1}`)
        : null;
    const kind = n.type === 'annotation' && n.note.trim() ? 'Note' : TYPE_LABEL[n.type];
    lines.push(`### ${kind}${chapter ? ` · ${oneLine(chapter)}` : ''}`);
    lines.push(`cfi: ${n.cfi}`);
    if (n.text?.trim()) lines.push(`> ${oneLine(n.text)}`);
    if (n.note.trim()) lines.push(`Note: ${oneLine(n.note)}`);
    lines.push('');
  }
  return lines.join('\n');
}

export type AnnotationsFs = {
  writeText(path: string, content: string): Promise<void>;
};

/** Last content written per book, so unchanged exports skip the disk write. */
const lastWritten = new Map<string, string>();

export async function exportBookAnnotations(input: {
  fs: AnnotationsFs;
  bookId: string;
  bookTitle: string;
  booknotes: BookNote[];
  getChapterTitle?: (sectionIndex: number) => string | null;
}): Promise<void> {
  const content = formatAnnotationsMarkdown(input.booknotes, input);
  if (lastWritten.get(input.bookId) === content) return;
  await input.fs.writeText(annotationsExportPath(input.bookId), content);
  lastWritten.set(input.bookId, content);
}
