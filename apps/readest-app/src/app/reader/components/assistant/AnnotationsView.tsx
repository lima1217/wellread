'use client';

import clsx from 'clsx';
import React, { useCallback, useMemo } from 'react';
import * as CFI from 'foliate-js/epubcfi.js';
import { LuMessageSquareQuote, LuPencil } from 'react-icons/lu';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useReadingAssistantStore } from '@/services/wellread/assistant/readingAssistantStore';
import { jumpToCfi } from '@/services/wellread/assistant/readerJump';
import { findTocItemBS } from '@/services/nav';
import { BookNote, HighlightColor } from '@/types/book';

interface AnnotationsViewProps {
  bookKey: string;
  /** Called after quoting a highlight into the chat (return to chat pane). */
  onQuote: () => void;
}

type AnnotationGroup = { key: string; label: string; notes: BookNote[] };

const pressScaleClass =
  'not-eink:active:scale-[0.96] not-eink:transition-transform not-eink:duration-150 not-eink:ease-out';

const AnnotationsView: React.FC<AnnotationsViewProps> = ({ bookKey, onQuote }) => {
  const _ = useTranslation();
  const { getConfig, getBookData } = useBookDataStore();
  const { settings } = useSettingsStore();
  const appendPendingQuote = useReadingAssistantStore((s) => s.appendPendingQuote);
  const { setNotebookNewAnnotation, setNotebookEditAnnotation } = useNotebookStore();

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

  const groups = useMemo<AnnotationGroup[]>(() => {
    const result: AnnotationGroup[] = [];
    for (const note of highlights) {
      const tocItem = findTocItemBS(toc ?? [], note.cfi);
      const key = tocItem?.href || '';
      const last = result[result.length - 1];
      // Highlights are already in reading order, so a chapter's notes are contiguous.
      if (last && last.key === key) {
        last.notes.push(note);
      } else {
        result.push({ key, label: tocItem?.label || '', notes: [note] });
      }
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

  return (
    <div className='flex h-full flex-col overscroll-contain'>
      <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2'>
        {groups.map((group) => (
          <section key={group.key} className='pt-2'>
            {group.label && (
              <h3 className='text-base-content/55 line-clamp-1 px-2 pb-1 text-[0.85em] font-medium'>
                {group.label}
              </h3>
            )}
            <ul className='space-y-1'>
              {group.notes.map((note) => {
                const color = customColors[note.color as HighlightColor] || note.color;
                const isUnderline = note.style === 'underline' || note.style === 'squiggly';
                return (
                  <li key={note.id} className='group relative'>
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
                      onClick={() => handleQuote(note, group.label)}
                      className={clsx(
                        'btn btn-ghost btn-circle absolute end-1 top-1 h-7 min-h-7 w-7',
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
                        setNotebookNewAnnotation(null);
                        setNotebookEditAnnotation({ ...note });
                      }}
                      className={clsx(
                        'btn btn-ghost btn-circle absolute end-8 top-1 h-7 min-h-7 w-7',
                        'text-base-content/50 hover:text-base-content',
                        'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
                        pressScaleClass,
                      )}
                    >
                      <LuPencil size={15} aria-hidden='true' />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
};

export default AnnotationsView;
