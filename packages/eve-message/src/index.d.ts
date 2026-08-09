/**
 * SessionMessage is the on-disk / wire shape. For assistant turns, `parts` is
 * authoritative when present; flat `reasoning` / `tools` / `content` are
 * denormalized for older sessions and compact summaries.
 */
export type SessionSource = {
  cfi: string;
  endCfi?: string;
  title?: string;
  path?: string;
};

export type SessionToolTrace = {
  id: string;
  name: string;
  args?: unknown;
  result?: unknown;
};

export type EveContextCompressedEvent = {
  type: 'context.compressed';
  beforeTokens: number;
  afterTokens: number;
  targetTokens: number;
  removedIds: string[];
  summary: {
    id: string;
    role: 'assistant' | 'user' | 'system';
    content: string;
    createdAt: number;
    compacted?: boolean;
  };
};

export type EveContextCompressFailedEvent = {
  type: 'context.compress_failed';
  message: string;
};

export type EveContextSideEvent = EveContextCompressedEvent | EveContextCompressFailedEvent;

export type EveSideEvent =
  | { type: 'error'; message: string }
  | { type: 'abort'; reason?: string }
  | EveContextSideEvent;

export declare const EVE_CONTEXT_COMPRESSED_CHUNK: 'data-eve-context-compressed';
export declare const EVE_CONTEXT_COMPRESS_FAILED_CHUNK: 'data-eve-context-compress-failed';

export declare function encodeEveSideChunk(
  event: EveContextSideEvent,
): { type: string; data?: unknown } | null;

export declare function decodeEveSideChunk(
  chunk: { type: string; data?: unknown; errorText?: string; reason?: unknown } | null | undefined,
): EveSideEvent | null;

export type PersistableUIPart =
  | { type: 'text'; text: string; state?: string }
  | { type: 'reasoning'; text: string; state?: string }
  | {
      type: 'dynamic-tool';
      toolCallId: string;
      toolName: string;
      state: string;
      input?: unknown;
      output?: unknown;
    };

export type SessionMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  modelContent?: string;
  reasoning?: string;
  sources?: SessionSource[];
  tools?: SessionToolTrace[];
  modelMessages?: unknown[];
  compacted?: boolean;
  /** Ordered UI parts — preferred render/persist shape for assistant turns. */
  parts?: unknown[];
};

export declare function persistablePartsFromUIMessage(msg: {
  parts?: unknown[] | null;
} | null | undefined): PersistableUIPart[];

export declare function sessionToUIMessage(msg: SessionMessage): {
  id: string;
  role: string;
  metadata?: Record<string, unknown>;
  parts: PersistableUIPart[];
};

export declare function uiMessageToSession(
  msg: { id: string; role: string; parts?: unknown[]; metadata?: unknown },
  extras?: {
    modelMessages?: unknown[];
    sources?: SessionSource[];
    createdAt?: number;
  },
): SessionMessage;

export declare function textFromUIMessage(msg: {
  parts?: Array<{ type: string; text?: string }> | null;
} | null | undefined): string;

export declare function reasoningFromUIMessage(msg: {
  parts?: Array<{ type: string; text?: string }> | null;
} | null | undefined): string;

export declare function toolsFromUIMessage(msg: {
  parts?: unknown[] | null;
} | null | undefined): SessionToolTrace[];

/** DeepSeek API hostname gate shared by FE ModelProfile + eve-sidecar. */
export declare function isDeepSeekApiHost(
  baseURL: string | null | undefined,
): boolean;
