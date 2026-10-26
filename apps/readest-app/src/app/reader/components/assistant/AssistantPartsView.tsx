'use client';

import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';

import { useTranslation } from '@/hooks/useTranslation';
import {
  collectAssistantCitations,
  linkifyBareEpubCfi,
  markInlineCitations,
  type AssistantCitation,
} from '@/services/wellread/assistant/cfiLinks';
import {
  assistantPartInputsFromMessage,
  coalesceAssistantParts,
} from '@/services/wellread/assistant/displayParts';
import type { EveMessage } from '@/services/wellread/assistant/eveClient';
import { ReasoningBlock, ToolsBlock } from './AssistantTools';
import {
  citationBadgeClass,
  createAssistantMarkdownComponents,
  focusRing,
  jumpToCfi,
} from './AssistantMarkdown';

export const AssistantPartsView = memo(function AssistantPartsView({
  msg,
  bookKey,
  isLive,
}: {
  msg: EveMessage;
  bookKey: string;
  isLive: boolean;
}) {
  const _ = useTranslation();
  const passageLabel = _('Passage');
  const hasText = Boolean(msg.content.trim());
  const forceCollapsed = hasText && !isLive;
  const segments = useMemo(
    () => coalesceAssistantParts(assistantPartInputsFromMessage(msg)),
    [msg],
  );
  const citations = useMemo(
    () => collectAssistantCitations(msg.content, msg.sources, passageLabel),
    [msg.content, msg.sources, passageLabel],
  );
  const components = useMemo(
    () =>
      createAssistantMarkdownComponents({
        bookKey,
        sources: msg.sources,
        citations,
        passageLabel,
      }),
    [bookKey, msg.sources, citations, passageLabel],
  );

  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === 'reasoning') {
          return (
            <ReasoningBlock
              key={`reasoning-${i}`}
              reasoning={segment.text}
              forceCollapsed={forceCollapsed}
            />
          );
        }
        if (segment.kind === 'tools') {
          return (
            <ToolsBlock key={`tools-${i}`} tools={segment.tools} forceCollapsed={forceCollapsed} />
          );
        }
        return (
          <MarkdownSegment
            key={`text-${i}`}
            text={segment.text}
            sources={msg.sources}
            passageLabel={passageLabel}
            components={components}
          />
        );
      })}
      {!isLive && citations.length ? (
        <CitationList citations={citations} bookKey={bookKey} passageLabel={passageLabel} />
      ) : null}
    </>
  );
});

/** Numbered sources under a finished reply; excluded from copied text. */
function CitationList({
  citations,
  bookKey,
  passageLabel,
}: {
  citations: AssistantCitation[];
  bookKey: string;
  passageLabel: string;
}) {
  const _ = useTranslation();
  return (
    <div
      data-citation=''
      className='border-base-content/10 mt-3 flex flex-col gap-0.5 border-t pt-2 font-sans text-[0.8em] select-none'
    >
      <div className='text-base-content/40 px-1 pb-0.5'>{_('Sources')}</div>
      {citations.map((c, i) => (
        <button
          key={c.cfi}
          type='button'
          className={clsx(
            'text-base-content/65 hover:text-base-content hover:bg-base-200/60',
            'flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-start transition-colors',
            focusRing,
          )}
          onClick={() => void jumpToCfi(bookKey, c.cfi)}
        >
          <span className={citationBadgeClass}>{i + 1}</span>
          <span className='min-w-0 flex-1 truncate'>{c.title || passageLabel}</span>
        </button>
      ))}
    </div>
  );
}

const MarkdownSegment = memo(function MarkdownSegment({
  text,
  sources,
  passageLabel,
  components,
}: {
  text: string;
  sources: EveMessage['sources'];
  passageLabel: string;
  components: ReturnType<typeof createAssistantMarkdownComponents>;
}) {
  const linked = useMemo(
    () => markInlineCitations(linkifyBareEpubCfi(text, sources, passageLabel)),
    [text, sources, passageLabel],
  );
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {linked}
    </ReactMarkdown>
  );
});
