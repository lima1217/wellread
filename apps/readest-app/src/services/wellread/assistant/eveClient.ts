/**
 * Eve-compatible HTTP client for Reading Assistant sessions.
 * Turns stream AI SDK UIMessage chunks (SSE).
 */

import { sessionToUIMessage, uiMessageToSession } from '@wellread/eve-message';
import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import { useEveConnectionStore } from '../eveConnectionStore';
import { eveFetch } from './eveFetch';

type EveUIMessagePart = UIMessage['parts'][number];

export type EveSource = {
  cfi: string;
  endCfi?: string;
  title?: string;
  path?: string;
};

/** Client-reported reading position for the sidecar reading-context envelope. */
export type EveReaderState = {
  chapter?: string;
  cfi?: string;
  /** 0-based EPUB spine index from reader progress when available. */
  sectionIndex?: number;
};

export type EveToolTrace = {
  id: string;
  name: string;
  args?: unknown;
  result?: unknown;
};

export type EveMessageQuote = {
  text: string;
  chapterTitle?: string | null;
};

export type EveMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  /** Ordered UI parts when available (preferred for rendering). */
  parts?: EveUIMessagePart[];
  /** Model chain-of-thought when Thinking Mode is Think (denormalized). */
  reasoning?: string;
  /** Client-side Pending Quotes attached to this user turn (not always persisted). */
  quotes?: EveMessageQuote[];
  sources?: EveSource[];
  tools?: EveToolTrace[];
  /** True when this message is an LLM compaction of earlier turns. */
  compacted?: boolean;
};

export type EveSessionMeta = {
  id: string;
  bookId: string;
  bookTitle?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type EveSession = EveSessionMeta & { messages: EveMessage[] };

export type ThinkingMode = 'think' | 'fast';

export type EveStreamEvent =
  | { type: 'ui-message'; message: UIMessage }
  | {
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
    }
  | { type: 'context.compress_failed'; message: string }
  | { type: 'error'; message: string }
  | { type: 'abort'; reason?: string };

function authHeaders(token: string | undefined): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function base(): { baseUrl: string; token?: string } {
  if (typeof window === 'undefined') {
    throw new Error('eve client requires browser');
  }
  const info = useEveConnectionStore.getState().info;
  const baseUrl = (info?.baseUrl || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('eve sidecar not connected');
  return { baseUrl, token: info?.token };
}

export async function listEveSessions(bookId: string): Promise<EveSessionMeta[]> {
  const { baseUrl, token } = base();
  const res = await eveFetch(`${baseUrl}/eve/v1/sessions?bookId=${encodeURIComponent(bookId)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`list sessions failed: ${res.status}`);
  const data = (await res.json()) as { sessions: EveSessionMeta[] };
  return data.sessions;
}

export type EveSkillSummary = {
  id: string;
  name: string;
  description: string;
  path: string;
  source: 'user' | 'bundled';
  /** False when a bundled default is listed for management but currently hidden. */
  enabled: boolean;
};

export async function listEveSkills(options?: {
  includeDisabled?: boolean;
}): Promise<EveSkillSummary[]> {
  const { baseUrl, token } = base();
  const qs = options?.includeDisabled ? '?includeDisabled=1' : '';
  const res = await eveFetch(`${baseUrl}/eve/v1/skills${qs}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`list skills failed: ${res.status}`);
  const data = (await res.json()) as { skills: EveSkillSummary[] };
  return (data.skills ?? []).map((s) => ({
    ...s,
    enabled: s.enabled !== false,
  }));
}

export async function createEveSession(input: {
  bookId: string;
  bookTitle?: string;
  title?: string;
}): Promise<EveSession> {
  const { baseUrl, token } = base();
  const res = await eveFetch(`${baseUrl}/eve/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`create session failed: ${res.status}`);
  return (await res.json()) as EveSession;
}

export async function getEveSession(id: string): Promise<EveSession> {
  const { baseUrl, token } = base();
  const res = await eveFetch(`${baseUrl}/eve/v1/sessions/${encodeURIComponent(id)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`get session failed: ${res.status}`);
  return (await res.json()) as EveSession;
}

export async function deleteEveSession(id: string): Promise<void> {
  const { baseUrl, token } = base();
  const res = await eveFetch(`${baseUrl}/eve/v1/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 204) throw new Error(`delete session failed: ${res.status}`);
}

/** Convert Response body → UIMessageChunk stream (AI SDK SSE). */
export function responseToUIMessageChunkStream(
  body: ReadableStream<Uint8Array>,
): ReadableStream<UIMessageChunk> {
  return parseJsonEventStream({
    stream: body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream<
      { success: true; value: UIMessageChunk } | { success: false; error: unknown },
      UIMessageChunk
    >({
      transform(chunk, controller) {
        if (!chunk.success) {
          throw chunk.error instanceof Error ? chunk.error : new Error(String(chunk.error));
        }
        controller.enqueue(chunk.value);
      },
    }),
  );
}

export async function* streamEveTurn(
  sessionId: string,
  message: string,
  signal?: AbortSignal,
  options?: {
    thinkingMode?: ThinkingMode;
    readerState?: EveReaderState | null;
  },
): AsyncGenerator<EveStreamEvent> {
  const { baseUrl, token } = base();
  const thinkingMode = options?.thinkingMode === 'think' ? 'think' : 'fast';
  const readerState = options?.readerState ?? undefined;
  const body: Record<string, unknown> = { message, thinkingMode };
  if (
    readerState &&
    (readerState.chapter || readerState.cfi || typeof readerState.sectionIndex === 'number')
  ) {
    body['readerState'] = {
      ...(readerState.chapter ? { chapter: readerState.chapter } : {}),
      ...(readerState.cfi ? { cfi: readerState.cfi } : {}),
      ...(typeof readerState.sectionIndex === 'number'
        ? { sectionIndex: readerState.sectionIndex }
        : {}),
    };
  }
  const res = await eveFetch(`${baseUrl}/eve/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`turn failed: ${res.status} ${detail}`);
  }

  const chunkStream = responseToUIMessageChunkStream(res.body);
  const [forSide, forMessages] = chunkStream.tee();

  const sideReader = forSide.getReader();
  const sideQueue: EveStreamEvent[] = [];
  let sideDone = false;
  let sideError: unknown = null;

  const pumpSide = (async () => {
    try {
      while (true) {
        const { done, value } = await sideReader.read();
        if (done) break;
        const side = uiChunkToSideEvent(value);
        if (side) sideQueue.push(side);
      }
    } catch (err) {
      sideError = err;
    } finally {
      sideDone = true;
    }
  })();

  try {
    for await (const uiMessage of readUIMessageStream({ stream: forMessages })) {
      while (sideQueue.length) {
        yield sideQueue.shift()!;
      }
      if (sideError) throw sideError;
      yield { type: 'ui-message', message: uiMessage };
    }
    await pumpSide;
    if (sideError) throw sideError;
    while (sideQueue.length) {
      yield sideQueue.shift()!;
    }
    // Wait briefly if side pump still finishing after messages end.
    while (!sideDone) {
      await new Promise((r) => setTimeout(r, 0));
      while (sideQueue.length) {
        yield sideQueue.shift()!;
      }
    }
  } finally {
    await sideReader.cancel().catch(() => {});
    await forMessages.cancel?.().catch(() => {});
  }
}

function uiChunkToSideEvent(chunk: UIMessageChunk): EveStreamEvent | null {
  if (chunk.type === 'error') {
    return { type: 'error', message: chunk.errorText };
  }
  if (chunk.type === 'abort') {
    return { type: 'abort', reason: 'reason' in chunk ? String(chunk.reason ?? '') : undefined };
  }
  if (chunk.type === 'data-eve-context-compressed') {
    const data = chunk.data as {
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
    return { type: 'context.compressed', ...data };
  }
  if (chunk.type === 'data-eve-context-compress-failed') {
    const data = chunk.data as { message: string };
    return { type: 'context.compress_failed', message: data.message };
  }
  return null;
}

/** Flatten UIMessage → EveMessage for store/render helpers (shared converter). */
export function uiMessageToEveMessage(
  message: UIMessage,
  extras?: { quotes?: EveMessageQuote[]; createdAt?: number },
): EveMessage {
  const session = uiMessageToSession(message, { createdAt: extras?.createdAt });
  return {
    id: session.id,
    role: session.role,
    content: session.content,
    createdAt: session.createdAt,
    ...(session.parts?.length ? { parts: session.parts as EveUIMessagePart[] } : {}),
    ...(session.reasoning ? { reasoning: session.reasoning } : {}),
    ...(session.tools?.length ? { tools: session.tools } : {}),
    ...(session.sources?.length ? { sources: session.sources } : {}),
    ...(session.compacted ? { compacted: true } : {}),
    ...(extras?.quotes?.length ? { quotes: extras.quotes } : {}),
  };
}

/** Ensure disk messages have denormalized fields + ordered parts for UI. */
export function normalizeEveMessage(msg: EveMessage): EveMessage {
  const ui = sessionToUIMessage({
    id: msg.id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.createdAt,
    ...(msg.reasoning ? { reasoning: msg.reasoning } : {}),
    ...(msg.tools?.length ? { tools: msg.tools } : {}),
    ...(msg.sources?.length ? { sources: msg.sources } : {}),
    ...(msg.compacted ? { compacted: true } : {}),
    ...(msg.parts?.length ? { parts: msg.parts } : {}),
  });
  return uiMessageToEveMessage(ui as UIMessage, {
    quotes: msg.quotes,
    createdAt: msg.createdAt,
  });
}
