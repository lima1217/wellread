/**
 * Eve-compatible HTTP client for Reading Assistant sessions.
 * Turns stream AI SDK UIMessage chunks (SSE).
 */

import {
  decodeEveSideChunk,
  sessionToUIMessage,
  uiMessageToSession,
  type EveSideEvent,
  type SessionMessage,
  type SessionSource,
  type SessionToolTrace,
} from '@wellread/eve-message';
import { normalizeReaderState, type ReaderState } from '@wellread/reading-context';
import type { PendingQuoteForTurn } from '@wellread/quote-wire';
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

/**
 * Host view of a session message. `parts` is authoritative for assistant turns
 * when present; flat fields are denormalized / legacy. `quotes` is FE-only
 * (disk stores quote wire inside user `content`).
 */
export type EveMessage = Omit<SessionMessage, 'parts'> & {
  parts?: EveUIMessagePart[];
  quotes?: PendingQuoteForTurn[];
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

export type EveStreamEvent = { type: 'ui-message'; message: UIMessage } | EveSideEvent;

export type { SessionSource, SessionToolTrace, ReaderState, PendingQuoteForTurn };

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
    readerState?: ReaderState | null;
  },
): AsyncGenerator<EveStreamEvent> {
  const { baseUrl, token } = base();
  const thinkingMode = options?.thinkingMode === 'think' ? 'think' : 'fast';
  const readerState = normalizeReaderState(options?.readerState ?? null);
  const body: Record<string, unknown> = { message, thinkingMode };
  if (readerState) {
    body['readerState'] = readerState;
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
        const side = decodeEveSideChunk(value);
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

/**
 * Ask the sidecar to abort an in-flight turn for a session (Stop path).
 * Fire-and-forget: the socket-close abort remains the fallback when this
 * races the turn's start.
 */
export async function cancelEveTurn(sessionId: string): Promise<void> {
  const { baseUrl, token } = base();
  try {
    await eveFetch(`${baseUrl}/eve/v1/sessions/${encodeURIComponent(sessionId)}/turns/cancel`, {
      method: 'POST',
      headers: authHeaders(token),
    });
  } catch {
    // Ignore: the aborted fetch still closes the connection eventually.
  }
}

/** Flatten UIMessage → EveMessage for store/render helpers (shared converter). */
export function uiMessageToEveMessage(
  message: UIMessage,
  extras?: { quotes?: PendingQuoteForTurn[]; createdAt?: number },
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
