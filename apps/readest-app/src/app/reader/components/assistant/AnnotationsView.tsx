'use client';

import clsx from 'clsx';
import React, { useCallback, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import * as CFI from 'foliate-js/epubcfi.js';
import { LuMessageSquareQuote, LuPencil } from 'react-icons/lu';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useAnnotationNoteStore } from '@/store/annotationNoteStore';
import { useReadingAssistantStore } from '@/services/wellread/assistant/readingAssistantStore';
import { jumpToCfi } from '@/services/wellread/assistant/readerJump';
import { findTocItemBS } from '@/services/nav';
import { BookNote, HighlightColor } from '@/types/book';

interface AnnotationsViewProps {
  bookKey: string;
  /** Called after quoting a highlight into the chat (return to chat pane). */
  onQuote: () => void;
}

type AnnotationRow =
  | { kind: 'chapter'; key: string; label: string }
  | { kind: 'note'; key: string; note: BookNote; chapterTitle: string };

const pressScaleClass =
  'not-eink:active:scale-[0.96] not-eink:transition-transform not-eink:duration-150 not-eink:ease-out';

const AnnotationsView: React.FC<AnnotationsViewProps> = ({ bookKey, onQuote }) => {
  const _ = useTranslation();
  const { getConfig, getBookData } = useBookDataStore();
  const { settings } = useSettingsStore();
  const appendPendingQuote = useReadingAssistantStore((s) => s.appendPendingQuote);
  const { setNewAnnotation, setEditAnnotation } = useAnnotationNoteStore();

  const customColors = settings.globalReadSettings.customHighlightColors;
  const booknotes = getConfig(bookKey)?.booknotes;
  const toc = getBookData(bookKey)?.bookDoc?.toc;

  const highlights = useMemo(
    () =>
      (booknotes ?? [])
        .filter((n) => n.type === 'annotation' && !n.deletedAt && n.text?.trim())
        .sort((a, b) => CFI.compare(a.cfi, b.cfi)),
    [booknotes],
  );

  // Flat chapter-header + highlight rows so the list can be virtualized.
  const rows = useMemo<AnnotationRow[]>(() => {
    const result: AnnotationRow[] = [];
    let chapterKey: string | null = null;
    let chapterTitle = '';
    for (const note of highlights) {
      const tocItem = findTocItemBS(toc ?? [], note.cfi);
      const key = tocItem?.href || '';
      // Highlights are already in reading order, so a chapter's notes are contiguous.
      if (key !== chapterKey) {
        chapterKey = key;
        chapterTitle = tocItem?.label || '';
        if (chapterTitle) result.push({ kind: 'chapter', key: `h-${key}`, label: chapterTitle });
      }
      result.push({ kind: 'note', key: note.id, note, chapterTitle });
    }
    return result;
  }, [highlights, toc]);

  const handleQuote = useCallback(
    (note: BookNote, chapterTitle: string) => {
      appendPendingQuote({ text: note.text || '', chapterTitle, cfi: note.cfi });
      onQuote();
    },
    [appendPendingQuote, onQuote],
  );

  if (highlights.length === 0) {
    return (
      <div className='text-base-content/60 flex flex-col items-start gap-1 p-4 text-pretty leading-relaxed'>
        <p className='text-base-content/80 font-medium'>{_('No highlights in this book yet')}</p>
        <p className='text-[0.92em]'>{_('Select some text to highlight')}</p>
      </div>
    );
  }

  const renderRow = (index: number) => {
    const row = rows[index]!;
    if (row.kind === 'chapter') {
      return (
        <h3 className='text-base-content/55 line-clamp-1 px-4 pb-1 pt-3 text-[0.85em] font-medium'>
          {row.label}
        </h3>
      );
    }
    const { note } = row;
    const color = customColors[note.color as HighlightColor] || note.color;
    const isUnderline = note.style === 'underline' || note.style === 'squiggly';
    return (
      <div className='group relative px-2 pb-1'>
        <button
          type='button'
          className={clsx(
            'hover:bg-base-300/55 w-full rounded-xl px-2 py-2 pe-16 text-start',
            'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
            'transition-colors duration-150',
          )}
          title={_('Go to highlight')}
          onClick={() => void jumpToCfi(bookKey, note.cfi)}
        >
          <span
            className={clsx(
              'line-clamp-4 text-[0.92em] leading-relaxed',
              isUnderline && 'underline decoration-2',
              note.style === 'squiggly' && 'decoration-wavy',
            )}
            dir='auto'
          >
            <span
              className={clsx(note.style === 'highlight' && 'rounded-[4px] px-[2px]')}
              style={
                note.style === 'highlight'
                  ? {
                      backgroundColor: `color-mix(in srgb, ${color} calc(var(--overlayer-highlight-opacity, 0.3) * 100%), transparent)`,
                    }
                  : isUnderline
                    ? {
                        textDecorationColor: `color-mix(in srgb, ${color} 80%, transparent)`,
                      }
                    : undefined
              }
            >
              {note.text}
            </span>
          </span>
          {note.note?.trim() && (
            <span
              className='border-base-content/20 text-base-content/75 mt-1.5 block whitespace-pre-wrap border-s-2 ps-2 text-[0.88em] leading-relaxed'
              dir='auto'
            >
              {note.note}
            </span>
          )}
        </button>
        <button
          type='button'
          title={_('Ask about this')}
          aria-label={_('Ask about this')}
          onClick={() => handleQuote(note, row.chapterTitle)}
          className={clsx(
            'btn btn-ghost btn-circle absolute end-3 top-1 h-7 min-h-7 w-7',
            'text-base-content/50 hover:text-base-content',
            'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
            pressScaleClass,
          )}
        >
          <LuMessageSquareQuote size={15} aria-hidden='true' />
        </button>
        <button
          type='button'
          title={_('Edit note')}
          aria-label={_('Edit note')}
          onClick={() => {
            setNewAnnotation(null);
            setEditAnnotation({ ...note });
          }}
          className={clsx(
            'btn btn-ghost btn-circle absolute end-10 top-1 h-7 min-h-7 w-7',
            'text-base-content/50 hover:text-base-content',
            'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
            pressScaleClass,
          )}
        >
          <LuPencil size={15} aria-hidden='true' />
        </button>
      </div>
    );
  };

  return (
    <div className='min-h-0 flex-1'>
      <Virtuoso
        style={{ height: '100%' }}
        className='overscroll-contain'
        totalCount={rows.length}
        computeItemKey={(index) => rows[index]?.key ?? index}
        itemContent={renderRow}
      />
    </div>
  );
};

export default AnnotationsView;
