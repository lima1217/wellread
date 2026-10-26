'use client';

import { useCallback, useState, type ClipboardEvent, type ReactNode } from 'react';
import { CheckIcon, CopyIcon, XIcon } from 'lucide-react';
import clsx from 'clsx';

import { useTranslation } from '@/hooks/useTranslation';
import { writeTextToClipboard } from '@/utils/clipboard';
import type { PendingQuoteForTurn } from '@wellread/quote-wire';
import { stripAssistantCfiCitations } from '@/services/wellread/assistant/cfiLinks';
import type { EveMessage } from '@/services/wellread/assistant/eveClient';
import type { PendingQuote } from '@/services/wellread/assistant/readingAssistantStore';
import { formatWorkDuration } from '@/services/wellread/assistant/sessionUi';
import { focusRing, messageTypeClass } from './AssistantMarkdown';

/** Quote text that jumps to its passage in the book when it carries a cfi. */
function QuoteText({
  cfi,
  onJump,
  title,
  className,
  children,
}: {
  cfi?: string | null;
  onJump?: (cfi: string) => void;
  title: string;
  className: string;
  children: ReactNode;
}) {
  const _ = useTranslation();
  if (!cfi || !onJump) {
    return (
      <span className={className} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button
      type='button'
      className={clsx(className, 'hover:text-base-content text-start transition-colors', focusRing)}
      title={`${title}\n${_('Show in book')}`}
      onClick={() => onJump(cfi)}
    >
      {children}
    </button>
  );
}

export function QuoteStack({
  quotes,
  onJump,
}: {
  quotes: PendingQuoteForTurn[];
  onJump?: (cfi: string) => void;
}) {
  if (!quotes.length) return null;
  return (
    <div className='mb-1.5 flex flex-col gap-1 pb-0.5'>
      {quotes.map((q, index) => {
        const chapter = q.chapterTitle?.trim();
        const full = chapter ? `${q.text} — 《${chapter}》` : q.text;
        return (
          <QuoteText
            key={q.id ?? `q-${index}`}
            cfi={q.cfi}
            onJump={onJump}
            title={full}
            className='border-base-content/25 text-base-content/70 line-clamp-2 border-s-2 ps-1.5 text-[0.85em] leading-snug'
          >
            {q.text}
            {chapter ? <span className='text-base-content/50'> — 《{chapter}》</span> : null}
          </QuoteText>
        );
      })}
    </div>
  );
}

export type Suggestion = { label: string; message: string };

/** One-click turns: starters, follow-ups, actions on Pending Quotes. */
export function SuggestionChips({
  suggestions,
  disabled,
  onPick,
}: {
  suggestions: Suggestion[];
  disabled?: boolean;
  onPick: (message: string) => void;
}) {
  if (!suggestions.length) return null;
  return (
    <div className='flex flex-wrap gap-1.5 font-sans'>
      {suggestions.map((s) => (
        <button
          key={s.label}
          type='button'
          disabled={disabled}
          className={clsx(
            'eink-bordered border-base-content/15 hover:bg-base-200 rounded-full border px-3 py-1 text-sm transition-colors',
            'disabled:pointer-events-none disabled:opacity-40',
            focusRing,
          )}
          onClick={() => onPick(s.message)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Native copy of a selection inside an assistant reply: drop citation markers
 * and the sources list so pasted text is plain prose.
 */
export function copySelectionWithoutCitations(e: ClipboardEvent<HTMLElement>) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;
  const holder = document.createElement('div');
  for (let i = 0; i < selection.rangeCount; i += 1) {
    holder.appendChild(selection.getRangeAt(i).cloneContents());
  }
  const citations = holder.querySelectorAll('[data-citation]');
  if (!citations.length) return;
  citations.forEach((node) => node.remove());
  // innerText needs layout to turn blocks into line breaks.
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:pre-wrap';
  document.body.appendChild(holder);
  const text = holder.innerText.trim();
  document.body.removeChild(holder);
  e.preventDefault();
  e.clipboardData.setData('text/plain', text);
  e.clipboardData.setData('text/html', holder.innerHTML);
}

export function PendingReplyDots({ label }: { label?: string }) {
  const _ = useTranslation();
  return (
    <div
      className={clsx(
        messageTypeClass,
        'text-base-content/55 me-1 flex items-center gap-2 px-0.5 py-0.5',
      )}
      role='status'
    >
      <span className='min-w-0 truncate font-sans text-[0.85em] leading-none'>
        {label ?? _('Thinking…')}
      </span>
      <span className='assistant-pending-dots inline-flex items-center gap-1' aria-hidden='true'>
        <span className='bg-base-content size-1 rounded-full' />
        <span className='bg-base-content size-1 rounded-full' />
        <span className='bg-base-content size-1 rounded-full' />
      </span>
    </div>
  );
}

const messageActionBtn = clsx(
  'hover:text-base-content relative inline-flex size-6 items-center justify-center',
  'after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2',
  'transition-colors disabled:pointer-events-none disabled:opacity-40',
  focusRing,
);

/** Icon-only action in a message's footer row (same chassis as Copy). */
export function MessageActionButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      className={messageActionBtn}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function CopyMessageButton({
  content,
  workedMs,
  children,
}: {
  content: string;
  workedMs?: number;
  /** Extra footer actions rendered after Copy (regenerate, save note, …). */
  children?: ReactNode;
}) {
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
        className={messageActionBtn}
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
      {children}
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
  onJump,
  children,
}: {
  quotes: PendingQuote[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onJump?: (cfi: string) => void;
  /** Quick actions on the quotes, under the list. */
  children?: ReactNode;
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
              <QuoteText
                cfi={q.cfi}
                onJump={onJump}
                className='text-base-content/80 line-clamp-2 min-w-0 flex-1 text-[0.85em] leading-snug select-text'
                title={full}
              >
                {q.text}
                {q.chapterTitle ? (
                  <span className='text-base-content/45'> · 《{q.chapterTitle}》</span>
                ) : null}
              </QuoteText>
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
      {children}
    </div>
  );
}
