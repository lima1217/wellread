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
