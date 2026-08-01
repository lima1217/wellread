'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';

import { useTranslation } from '@/hooks/useTranslation';
import type { SessionToolTrace } from '@wellread/eve-message';
import { summarizeToolTrace } from '@/services/wellread/assistant/displayParts';
import { focusRing } from './AssistantMarkdown';

export function ToolStep({ tool }: { tool: SessionToolTrace }) {
  const _ = useTranslation();
  const [open, setOpen] = useState(false);
  const pending = tool.result === undefined;
  return (
    <div className='text-base-content/60 border-base-content/15 eink-bordered mb-2 border-s ps-2.5 font-sans text-[0.85em] leading-snug'>
      <button
        type='button'
        className={clsx(
          'hover:text-base-content/80 flex w-full items-baseline gap-1.5 text-start',
          focusRing,
        )}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className='font-medium'>{tool.name}</span>
        <span className='text-base-content/40'>
          {pending ? _('Running…') : open ? _('Collapse') : _('Details')}
        </span>
      </button>
      {open && !pending ? (
        <div className='text-base-content/70 mt-1 space-y-0.5 break-words font-mono'>
          {tool.args != null ? <div>{JSON.stringify(tool.args)}</div> : null}
          {tool.result != null ? (
            <div className='text-base-content/50'>{JSON.stringify(tool.result)}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ReasoningBlock({
  reasoning,
  forceCollapsed,
}: {
  reasoning: string;
  forceCollapsed?: boolean;
}) {
  const _ = useTranslation();
  const [open, setOpen] = useState(!forceCollapsed);
  useEffect(() => {
    if (forceCollapsed) setOpen(false);
  }, [forceCollapsed]);
  if (!reasoning.trim()) return null;
  return (
    <details
      className='group border-base-content/10 mb-3.5 border-s ps-3'
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className={clsx(
          'text-base-content/50 hover:text-base-content/75 font-sans text-[0.8em] leading-none',
          'cursor-pointer list-none select-none',
          '[&::-webkit-details-marker]:hidden',
          focusRing,
        )}
      >
        {_('Thinking')}
      </summary>
      <pre
        className={clsx(
          'text-base-content/55 mt-2.5 max-h-56 overflow-y-auto overscroll-contain',
          'whitespace-pre-wrap font-sans text-[0.9em] leading-[1.6]',
        )}
      >
        {reasoning}
      </pre>
    </details>
  );
}

export function ToolsBlock({
  tools,
  forceCollapsed,
}: {
  tools: SessionToolTrace[];
  forceCollapsed?: boolean;
}) {
  const _ = useTranslation();
  const [open, setOpen] = useState(!forceCollapsed);
  useEffect(() => {
    if (forceCollapsed) setOpen(false);
  }, [forceCollapsed]);
  if (!tools.length) return null;
  const pending = tools.some((t) => t.result === undefined);
  const summary = summarizeToolTrace(tools);
  if (!summary) return null;
  const summaryText =
    summary.label === 'Saved notes'
      ? _('Saved notes · {{count}} step(s)', { count: summary.count })
      : _('Searched extract · {{count}} step(s)', { count: summary.count });
  return (
    <details
      className='group border-base-content/10 mb-3.5 border-s ps-3'
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className={clsx(
          'text-base-content/50 hover:text-base-content/75 font-sans text-[0.8em] leading-none',
          'cursor-pointer list-none select-none',
          '[&::-webkit-details-marker]:hidden',
          focusRing,
        )}
      >
        <span>{summaryText}</span>
        {pending ? <span className='text-base-content/40 ms-1.5'>{_('Running…')}</span> : null}
      </summary>
      <div className='mt-2.5'>
        {tools.map((t) => (
          <ToolStep key={t.id} tool={t} />
        ))}
      </div>
    </details>
  );
}
