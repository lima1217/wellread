'use client';

import { useCallback, useState } from 'react';
import { CheckIcon, CopyIcon, XIcon } from 'lucide-react';
import clsx from 'clsx';

import { useTranslation } from '@/hooks/useTranslation';
import { writeTextToClipboard } from '@/utils/clipboard';
import {
  formatWorkDuration,
  stripAssistantCfiCitations,
} from '@/services/wellread/assistant/helpers';
import type { EveMessage, EveMessageQuote } from '@/services/wellread/assistant/eveClient';
import type { PendingQuote } from '@/services/wellread/assistant/readingAssistantStore';
import { focusRing, messageTypeClass } from './AssistantMarkdown';

export function QuoteStack({ quotes }: { quotes: EveMessageQuote[] }) {
  if (!quotes.length) return null;
  return (
    <div className='mb-1.5 flex flex-col gap-1 pb-0.5'>
      {quotes.map((q) => {
        const chapter = q.chapterTitle?.trim();
        const full = chapter ? `${q.text} — 《${chapter}》` : q.text;
        return (
          <div
            key={`${chapter ?? ''}:${q.text}`}
            title={full}
            className='border-base-content/25 text-base-content/70 line-clamp-2 border-s-2 ps-1.5 text-[0.85em] leading-snug'
          >
            {q.text}
            {chapter ? <span className='text-base-content/50'> — 《{chapter}》</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export function PendingReplyDots() {
  const _ = useTranslation();
  return (
    <div
      className={clsx(
        messageTypeClass,
        'text-base-content/55 me-1 flex items-center gap-2 px-0.5 py-0.5',
      )}
      role='status'
    >
      <span className='font-sans text-[0.85em] leading-none'>{_('Thinking…')}</span>
      <span className='assistant-pending-dots inline-flex items-center gap-1' aria-hidden='true'>
        <span className='bg-base-content size-1 rounded-full' />
        <span className='bg-base-content size-1 rounded-full' />
        <span className='bg-base-content size-1 rounded-full' />
      </span>
    </div>
  );
}

export function CopyMessageButton({ content, workedMs }: { content: string; workedMs?: number }) {
  const _ = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await writeTextToClipboard(stripAssistantCfiCitations(content));
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const duration = workedMs != null && workedMs > 0 ? formatWorkDuration(workedMs) : null;

  return (
    <div className='text-base-content/40 mt-2 flex items-center gap-1.5 font-sans text-[0.8em] leading-none select-none'>
      <button
        type='button'
        className={clsx(
          'hover:text-base-content relative inline-flex size-6 items-center justify-center',
          'after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2',
          'transition-colors',
          focusRing,
        )}
        aria-label={copied ? _('Copied') : _('Copy')}
        onClick={() => {
          void handleCopy();
        }}
      >
        {copied ? (
          <CheckIcon size={12} aria-hidden='true' />
        ) : (
          <CopyIcon size={12} aria-hidden='true' />
        )}
      </button>
      {duration ? (
        <>
          <span className='text-base-content/25' aria-hidden='true'>
            ·
          </span>
          <span className='tabular-nums tracking-wide'>{duration}</span>
        </>
      ) : null}
    </div>
  );
}

export function assistantWorkedMs(
  messages: EveMessage[],
  index: number,
  opts: { live: boolean },
): number | undefined {
  const msg = messages[index];
  if (!msg || msg.role !== 'assistant') return undefined;
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = messages[i];
    if (prev?.role !== 'user') continue;
    const end = opts.live ? Date.now() : msg.createdAt;
    const ms = end - prev.createdAt;
    return ms > 0 ? ms : undefined;
  }
  return undefined;
}

export function PendingQuoteBar({
  quotes,
  onRemove,
  onClear,
}: {
  quotes: PendingQuote[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const _ = useTranslation();
  if (!quotes.length) return null;
  return (
    <div className='border-base-200/70 flex shrink-0 flex-col gap-2 border-b px-3 py-2.5'>
      <div className='text-base-content/45 flex items-center justify-between text-[0.8em] leading-none select-none'>
        <span>
          {_('Pending quotes')} <span className='tabular-nums'>({quotes.length})</span>
        </span>
        <button
          type='button'
          className={clsx(
            'hover:text-base-content rounded-md px-1.5 py-1 hover:bg-base-200/60',
            focusRing,
          )}
          onClick={onClear}
        >
          {_('Clear all')}
        </button>
      </div>
      <ul className='flex flex-col gap-1.5'>
        {quotes.map((q) => {
          const full = q.chapterTitle ? `${q.text} · 《${q.chapterTitle}》` : q.text;
          return (
            <li
              key={q.id}
              className={clsx(
                'bg-base-100/55 eink-bordered border-base-200/70 flex items-start gap-1 rounded-md border',
                'py-1.5 ps-2 pe-1',
              )}
            >
              <span
                className='border-base-content/25 text-base-content/40 mt-px shrink-0 border-s-2 ps-2 select-none'
                aria-hidden='true'
              >
                ❝
              </span>
              <span
                className='text-base-content/80 line-clamp-2 min-w-0 flex-1 text-[0.85em] leading-snug select-text'
                title={full}
              >
                {q.text}
                {q.chapterTitle ? (
                  <span className='text-base-content/45'> · 《{q.chapterTitle}》</span>
                ) : null}
              </span>
              <button
                type='button'
                className={clsx(
                  'text-base-content/40 hover:text-base-content hover:bg-base-200/80',
                  'relative flex size-6 shrink-0 items-center justify-center rounded-full',
                  'after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2',
                  focusRing,
                )}
                aria-label={_('Remove quote')}
                onClick={() => onRemove(q.id)}
              >
                <XIcon size={13} aria-hidden='true' />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
