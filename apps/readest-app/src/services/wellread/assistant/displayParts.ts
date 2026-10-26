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

/** What one tool step did, in reader terms (UI maps `kind` to a translated label). */
export type ToolStepDescription = {
  kind:
    | 'read_chapter'
    | 'read_passage'
    | 'read_annotations'
    | 'read_note'
    | 'read_skill'
    | 'search_book'
    | 'grep'
    | 'list_section'
    | 'list_files'
    | 'save_note'
    | 'web_search'
    | 'other';
  /** Chapter title, query, pattern or file name when known. */
  detail?: string;
  /** Hits / passages when the result reports them. */
  count?: number;
  /** Result withheld by the spoiler guard (whole or partly). */
  spoilerHidden?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function frontmatterTitle(content: unknown): string | undefined {
  if (typeof content !== 'string') return undefined;
  const m = /^---\r?\n[\s\S]*?^title:\s*(.+)$[\s\S]*?\r?\n---/m.exec(content);
  if (!m?.[1]) return undefined;
  const raw = m[1].trim();
  try {
    const parsed: unknown = JSON.parse(raw);
    return str(parsed);
  } catch {
    return str(raw.replace(/^['"]|['"]$/g, ''));
  }
}

function baseName(path: string | undefined): string | undefined {
  return path ? path.split('/').pop() || undefined : undefined;
}

/** Describe one tool step for the Tools block (replaces raw tool names). */
export function describeToolStep(tool: {
  name: string;
  args?: unknown;
  result?: unknown;
}): ToolStepDescription {
  const args = asRecord(tool.args);
  const result = asRecord(tool.result);
  const spoilerHidden =
    result['error'] === 'spoiler_guard' || typeof result['hiddenBySpoilerGuard'] === 'number';
  const extra = spoilerHidden ? { spoilerHidden } : {};
  const hitCount = Array.isArray(result['hits']) ? result['hits'].length : undefined;
  const path = str(args['path']);
  switch (tool.name) {
    case 'read_section_text': {
      const title = str(result['title']) ?? str(args['title']);
      const sectionIndex = result['sectionIndex'] ?? args['sectionIndex'];
      const chunkCount =
        typeof result['chunkCount'] === 'number' ? result['chunkCount'] : undefined;
      return {
        kind: 'read_chapter',
        ...(title
          ? { detail: title }
          : typeof sectionIndex === 'number'
            ? { detail: `#${sectionIndex + 1}` }
            : {}),
        ...(chunkCount !== undefined ? { count: chunkCount } : {}),
        ...extra,
      };
    }
    case 'read_file': {
      if (path?.includes('/.wellread/annotations/')) return { kind: 'read_annotations', ...extra };
      if (path?.includes('/.wellread/notes/')) {
        return { kind: 'read_note', ...(baseName(path) ? { detail: baseName(path) } : {}) };
      }
      if (path?.startsWith('/workspace/skills/')) {
        const id = path.split('/')[3];
        return { kind: 'read_skill', ...(id ? { detail: id } : {}) };
      }
      const title = frontmatterTitle(result['content']);
      return { kind: 'read_passage', ...(title ? { detail: title } : {}), ...extra };
    }
    case 'search_book': {
      const query = str(args['query']);
      return {
        kind: 'search_book',
        ...(query ? { detail: query } : {}),
        ...(hitCount !== undefined ? { count: hitCount } : {}),
        ...extra,
      };
    }
    case 'grep': {
      const pattern = str(args['pattern']);
      return {
        kind: 'grep',
        ...(pattern ? { detail: pattern } : {}),
        ...(hitCount !== undefined ? { count: hitCount } : {}),
        ...extra,
      };
    }
    case 'resolve_section': {
      const title = str(result['title']) ?? str(args['title']);
      const count = typeof result['count'] === 'number' ? result['count'] : undefined;
      return {
        kind: 'list_section',
        ...(title ? { detail: title } : {}),
        ...(count !== undefined ? { count } : {}),
        ...extra,
      };
    }
    case 'glob':
      return { kind: 'list_files', ...(hitCount !== undefined ? { count: hitCount } : {}) };
    case 'write_file':
      return { kind: 'save_note', ...(baseName(path) ? { detail: baseName(path) } : {}) };
    case 'web_search':
      return { kind: 'web_search', ...(str(args['query']) ? { detail: str(args['query']) } : {}) };
    default:
      return { kind: 'other', detail: tool.name };
  }
}
