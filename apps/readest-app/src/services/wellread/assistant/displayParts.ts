/**
 * Assistant stream-part coalescing for chat display.
 */

import { toolsFromUIMessage, type SessionToolTrace } from '@wellread/eve-message';

export type ToolTraceEntry = { name: string };

/** Label keys for tool-trace summary; UI interpolates count via i18n. */
export type ToolTraceSummaryLabel = 'Saved notes' | 'Searched extract';

export type ToolTraceSummary = {
  label: ToolTraceSummaryLabel;
  count: number;
};

/** Always-visible T3 summary for tool traces (expand shows params). */
export function summarizeToolTrace(tools: ToolTraceEntry[]): ToolTraceSummary | null {
  const count = tools.length;
  if (count === 0) return null;
  const onlyWrites = tools.every((t) => t.name === 'write_file');
  return {
    label: onlyWrites ? 'Saved notes' : 'Searched extract',
    count,
  };
}

export type AssistantPartInput =
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool'; tool: SessionToolTrace }
  | { kind: 'text'; text: string };

export type AssistantDisplaySegment =
  | { kind: 'reasoning'; text: string }
  | { kind: 'tools'; tools: SessionToolTrace[] }
  | { kind: 'text'; text: string };

/**
 * Merge stream parts for chat display: consecutive tools → one Tools block;
 * adjacent reasoning chunks concatenate; text flushes pending buffers.
 */
export function coalesceAssistantParts(parts: AssistantPartInput[]): AssistantDisplaySegment[] {
  const out: AssistantDisplaySegment[] = [];
  let reasoning = '';
  let tools: SessionToolTrace[] = [];

  const flushReasoning = () => {
    if (!reasoning.trim()) {
      reasoning = '';
      return;
    }
    out.push({ kind: 'reasoning', text: reasoning });
    reasoning = '';
  };
  const flushTools = () => {
    if (!tools.length) return;
    out.push({ kind: 'tools', tools });
    tools = [];
  };

  for (const part of parts) {
    if (part.kind === 'reasoning') {
      flushTools();
      reasoning += part.text;
      continue;
    }
    if (part.kind === 'tool') {
      flushReasoning();
      tools.push(part.tool);
      continue;
    }
    flushReasoning();
    flushTools();
    if (part.text.trim()) out.push({ kind: 'text', text: part.text });
  }
  flushReasoning();
  flushTools();
  return out;
}

type PartLike = { type?: string; text?: string; [key: string]: unknown };

/**
 * Build ordered display inputs from a message.
 * When `parts` exist they are authoritative; tool-* / dynamic-tool map via eve-message.
 * Flat reasoning/tools/content is the legacy fallback.
 */
export function assistantPartInputsFromMessage(msg: {
  content: string;
  reasoning?: string;
  tools?: SessionToolTrace[];
  parts?: PartLike[] | unknown[];
}): AssistantPartInput[] {
  const parts = msg.parts as PartLike[] | undefined;
  const hasText = Boolean(msg.content.trim());
  const inputs: AssistantPartInput[] = [];

  if (!parts?.length) {
    if (msg.reasoning?.trim()) inputs.push({ kind: 'reasoning', text: msg.reasoning });
    for (const t of msg.tools ?? []) {
      inputs.push({ kind: 'tool', tool: t });
    }
    if (hasText) inputs.push({ kind: 'text', text: msg.content });
    return inputs;
  }

  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'reasoning' && typeof part.text === 'string') {
      inputs.push({ kind: 'reasoning', text: part.text });
      continue;
    }
    const mapped = toolsFromUIMessage({ parts: [part] });
    if (mapped.length) {
      inputs.push({ kind: 'tool', tool: mapped[0]! });
      continue;
    }
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      inputs.push({ kind: 'text', text: part.text });
    }
  }
  return inputs;
}
