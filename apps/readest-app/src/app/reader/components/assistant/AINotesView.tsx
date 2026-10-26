'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LuArrowLeft, LuFileText, LuPencil, LuTrash2 } from 'react-icons/lu';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import {
  NoteChangedError,
  deleteEveNote,
  listEveNotes,
  readEveNote,
  saveEveNote,
} from '@/services/wellread/assistant/eveClient';
import {
  collectAssistantCitations,
  linkifyBareEpubCfi,
  markInlineCitations,
} from '@/services/wellread/assistant/cfiLinks';
import { useEveConnectionStore } from '@/services/wellread/eveConnectionStore';
import { eventDispatcher } from '@/utils/event';
import {
  createAssistantMarkdownComponents,
  focusRing,
  markdownBodyClass,
  messageTypeClass,
} from './AssistantMarkdown';

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Resolve an in-package Markdown link against the open page; null when it leaves the package. */
export function resolveNoteLink(from: string, href: string | undefined): string | null {
  if (!href || /^[a-z][\w+.-]*:/i.test(href) || href.startsWith('/')) return null;
  const target = decodeURIComponent(href.split('#')[0] ?? '');
  if (!target.toLowerCase().endsWith('.md')) return null;
  const parts = from.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (seg && seg !== '.') {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

const pressScaleClass =
  'not-eink:active:scale-[0.96] not-eink:transition-transform not-eink:duration-150 not-eink:ease-out';

const AINotesView: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const ready = useEveConnectionStore((s) => s.ready);
  const refresh = useEveConnectionStore((s) => s.refresh);
  const bookData = getBookData(bookKey);
  const bookId = bookData?.book?.hash || bookKey.split('-')[0] || '';

  const [files, setFiles] = useState<string[] | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [mtimeMs, setMtimeMs] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ready) void refresh();
  }, [ready, refresh]);

  useEffect(() => {
    if (!ready || !bookId) return;
    setFiles(null);
    listEveNotes(bookId)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [ready, bookId]);

  const toastError = useCallback((err: unknown, fallback: string) => {
    eventDispatcher.dispatch('toast', {
      type: 'error',
      message: err instanceof Error ? err.message : fallback,
    });
  }, []);

  const openNote = useCallback(
    async (path: string) => {
      try {
        const note = await readEveNote(bookId, path);
        setContent(note.content);
        setMtimeMs(note.mtimeMs);
        setOpenPath(path);
        setDraft(null);
      } catch (err) {
        toastError(err, _('Failed to open note'));
      }
    },
    [bookId, toastError, _],
  );

  // The editor shows the body only; the page's OKF frontmatter rides along unchanged.
  const frontmatter = useMemo(() => FRONTMATTER.exec(content)?.[0] ?? '', [content]);
  const body = content.slice(frontmatter.length);

  const handleSave = async () => {
    if (!openPath || draft === null) return;
    const next = frontmatter + draft;
    setSaving(true);
    try {
      let saved: number | null;
      try {
        saved = await saveEveNote(bookId, openPath, next, mtimeMs);
      } catch (err) {
        if (!(err instanceof NoteChangedError)) throw err;
        const overwrite = await appService?.ask(
          _('This note changed after you opened it. Replace it with your edit?'),
        );
        if (!overwrite) return;
        saved = await saveEveNote(bookId, openPath, next, undefined);
      }
      setContent(next);
      setMtimeMs(saved);
      setDraft(null);
    } catch (err) {
      toastError(err, _('Failed to save note'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!openPath || !(await appService?.ask(_('Delete this note page?')))) return;
    try {
      await deleteEveNote(bookId, openPath);
      setFiles((prev) => prev?.filter((f) => f !== openPath) ?? prev);
      setOpenPath(null);
    } catch (err) {
      toastError(err, _('Failed to delete note'));
    }
  };

  const passageLabel = _('Passage');
  const components = useMemo<Components>(() => {
    const base = createAssistantMarkdownComponents({
      bookKey,
      citations: collectAssistantCitations(body, undefined, passageLabel),
      passageLabel,
    });
    const BaseLink = base.a as React.ComponentType<React.ComponentProps<'a'>>;
    return {
      ...base,
      a: (props) => {
        const target = openPath ? resolveNoteLink(openPath, props.href) : null;
        if (!target) return <BaseLink {...props} />;
        return (
          <button
            type='button'
            className={clsx('underline decoration-from-font underline-offset-2', focusRing)}
            onClick={() => void openNote(target)}
          >
            {props.children}
          </button>
        );
      },
    };
  }, [bookKey, body, passageLabel, openPath, openNote]);

  if (!ready) {
    return (
      <div className='text-base-content/60 p-4 text-pretty leading-relaxed' aria-live='polite'>
        {_('Reading Assistant sidecar is starting…')}
      </div>
    );
  }

  if (openPath) {
    return (
      <div className='flex h-full min-h-0 flex-col'>
        <div className='flex flex-shrink-0 items-center gap-1 px-2 pb-1'>
          <button
            type='button'
            className={clsx(
              'btn btn-ghost btn-sm h-8 min-h-8 gap-1 rounded-full px-2',
              pressScaleClass,
            )}
            onClick={() => (draft === null ? setOpenPath(null) : setDraft(null))}
          >
            <LuArrowLeft size={15} aria-hidden='true' />
            {draft === null ? _('All notes') : _('Cancel')}
          </button>
          <span className='text-base-content/55 min-w-0 flex-1 truncate text-[0.85em]' dir='ltr'>
            {openPath}
          </span>
          {draft === null ? (
            <>
              <button
                type='button'
                title={_('Delete')}
                aria-label={_('Delete')}
                className={clsx(
                  'btn btn-ghost btn-circle hover:text-error h-8 min-h-8 w-8',
                  pressScaleClass,
                )}
                onClick={() => void handleDelete()}
              >
                <LuTrash2 size={15} aria-hidden='true' />
              </button>
              <button
                type='button'
                title={_('Edit')}
                aria-label={_('Edit')}
                className={clsx('btn btn-ghost btn-circle h-8 min-h-8 w-8', pressScaleClass)}
                onClick={() => setDraft(body)}
              >
                <LuPencil size={15} aria-hidden='true' />
              </button>
            </>
          ) : (
            <button
              type='button'
              className={clsx(
                'btn btn-contrast btn-sm h-8 min-h-8 rounded-full px-4',
                pressScaleClass,
              )}
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {_('Save')}
            </button>
          )}
        </div>
        {draft === null ? (
          <div
            className={clsx(
              'min-h-0 flex-1 select-text overflow-y-auto overscroll-contain px-4 pb-4',
              messageTypeClass,
              markdownBodyClass,
            )}
            dir='auto'
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {markInlineCitations(linkifyBareEpubCfi(body, undefined, passageLabel))}
            </ReactMarkdown>
          </div>
        ) : (
          <textarea
            className={clsx(
              'eink-bordered bg-base-100 border-base-content/10 mx-2 mb-2 min-h-0 flex-1 resize-none',
              'rounded-lg border p-3 font-mono text-[0.85em] leading-relaxed',
              focusRing,
            )}
            aria-label={openPath}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            dir='auto'
          />
        )}
      </div>
    );
  }

  if (files === null) {
    return (
      <div className='text-base-content/60 p-4 text-pretty leading-relaxed' aria-live='polite'>
        {_('Loading…')}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className='text-base-content/60 flex flex-col items-start gap-1 p-4 text-pretty leading-relaxed'>
        <p className='text-base-content/80 font-medium'>{_('No AI notes for this book yet')}</p>
        <p className='text-[0.92em]'>
          {_('Ask the assistant with /note to take notes on a chapter.')}
        </p>
      </div>
    );
  }

  return (
    <ul className='min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 py-1'>
      {files.map((file) => (
        <li key={file}>
          <button
            type='button'
            className={clsx(
              'hover:bg-base-200/70 flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-start',
              'transition-colors duration-150',
              focusRing,
            )}
            onClick={() => void openNote(file)}
          >
            <LuFileText size={15} className='text-base-content/55 shrink-0' aria-hidden='true' />
            <span className='min-w-0 flex-1 truncate' dir='ltr'>
              {file}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
};

export default AINotesView;
