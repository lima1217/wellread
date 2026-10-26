'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';

import { useTranslation } from '@/hooks/useTranslation';
import type { SessionToolTrace } from '@wellread/eve-message';
import {
  describeToolStep,
  summarizeToolTrace,
  type ToolStepDescription,
} from '@/services/wellread/assistant/displayParts';
import { focusRing } from './AssistantMarkdown';

const TOOL_JSON_MAX = 2048;

function truncateJson(value: unknown): string {
  try {
    const raw = JSON.stringify(value);
    if (raw.length <= TOOL_JSON_MAX) return raw;
    return `${raw.slice(0, TOOL_JSON_MAX - 1)}…`;
  } catch {
    return String(value);
  }
}

function useToolStepLabel() {
  const _ = useTranslation();
  return (d: ToolStepDescription): string => {
    const detail = d.detail ?? '';
    switch (d.kind) {
      case 'read_chapter':
        return d.count !== undefined
          ? _('Read chapter {{detail}} · {{count}} passage(s)', { detail, count: d.count })
          : _('Read chapter {{detail}}', { detail });
      case 'read_passage':
        return detail ? _('Read passage: {{detail}}', { detail }) : _('Read a passage');
      case 'read_annotations':
        return _('Read your highlights and notes');
      case 'read_note':
        return _('Read note {{detail}}', { detail });
      case 'read_skill':
        return _('Loaded skill {{detail}}', { detail });
      case 'search_book':
        return _('Searched the book for “{{detail}}” · {{count}} hit(s)', {
          detail,
          count: d.count ?? 0,
        });
      case 'grep':
        return _('Found “{{detail}}” · {{count}} hit(s)', { detail, count: d.count ?? 0 });
      case 'list_section':
        return _('Located section {{detail}}', { detail });
      case 'list_files':
        return _('Listed notes');
      case 'save_note':
        return _('Saved note {{detail}}', { detail });
      case 'web_search':
        return detail ? _('Searched the web for “{{detail}}”', { detail }) : _('Searched the web');
      default:
        return detail;
    }
  };
}

export function ToolStep({ tool }: { tool: SessionToolTrace }) {
  const _ = useTranslation();
  const label = useToolStepLabel();
  const [open, setOpen] = useState(false);
  const pending = tool.result === undefined;
  const described = describeToolStep(tool);
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
        <span className='min-w-0 truncate font-medium' title={tool.name}>
          {label(described)}
        </span>
        {described.spoilerHidden ? (
          <span className='text-base-content/40 shrink-0'>{_('Spoiler guard')}</span>
        ) : null}
        <span className='text-base-content/40 shrink-0'>
          {pending ? _('Running…') : open ? _('Collapse') : _('Details')}
        </span>
      </button>
      {open && !pending ? (
        <div className='text-base-content/70 mt-1 space-y-0.5 break-words font-mono'>
          {tool.args != null ? <div>{truncateJson(tool.args)}</div> : null}
          {tool.result != null ? (
            <div className='text-base-content/50'>{truncateJson(tool.result)}</div>
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
