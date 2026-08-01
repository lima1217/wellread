'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useTranslation } from '@/hooks/useTranslation';
import {
  assistantPartInputsFromMessage,
  coalesceAssistantParts,
  linkifyBareEpubCfi,
} from '@/services/wellread/assistant/helpers';
import type { EveMessage } from '@/services/wellread/assistant/eveClient';
import { ReasoningBlock, ToolsBlock } from './AssistantTools';
import { createAssistantMarkdownComponents } from './AssistantMarkdown';

export function AssistantPartsView({
  msg,
  bookKey,
  isLive,
}: {
  msg: EveMessage;
  bookKey: string;
  isLive: boolean;
}) {
  const _ = useTranslation();
  const hasText = Boolean(msg.content.trim());
  const forceCollapsed = hasText && !isLive;
  const inputs = assistantPartInputsFromMessage(msg);

  return (
    <>
      {coalesceAssistantParts(inputs).map((segment, i) => {
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
          <ReactMarkdown
            key={`text-${i}`}
            remarkPlugins={[remarkGfm]}
            components={createAssistantMarkdownComponents({
              bookKey,
              sources: msg.sources,
              passageLabel: _('Passage'),
            })}
          >
            {linkifyBareEpubCfi(segment.text, msg.sources, _('Passage'))}
          </ReactMarkdown>
        );
      })}
    </>
  );
}
