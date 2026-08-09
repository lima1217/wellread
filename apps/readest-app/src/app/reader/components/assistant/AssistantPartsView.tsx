'use client';

import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useTranslation } from '@/hooks/useTranslation';
import { linkifyBareEpubCfi } from '@/services/wellread/assistant/cfiLinks';
import {
  assistantPartInputsFromMessage,
  coalesceAssistantParts,
} from '@/services/wellread/assistant/displayParts';
import type { EveMessage } from '@/services/wellread/assistant/eveClient';
import { ReasoningBlock, ToolsBlock } from './AssistantTools';
import { createAssistantMarkdownComponents } from './AssistantMarkdown';

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
  const components = useMemo(
    () =>
      createAssistantMarkdownComponents({
        bookKey,
        sources: msg.sources,
        passageLabel,
      }),
    [bookKey, msg.sources, passageLabel],
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
    </>
  );
});

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
    () => linkifyBareEpubCfi(text, sources, passageLabel),
    [text, sources, passageLabel],
  );
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {linked}
    </ReactMarkdown>
  );
});
