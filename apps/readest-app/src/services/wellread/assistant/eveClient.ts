/**
 * Minimal eve-compatible HTTP client for Reading Assistant sessions.
 */

import { eveFetch } from './eveFetch';

export type EveSource = {
  cfi: string;
  endCfi?: string;
  title?: string;
  path?: string;
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
  /** Model chain-of-thought when Thinking Mode is Think (not part of the answer body). */
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
  | { type: 'message.user'; id: string; content: string }
  | { type: 'message.assistant.delta'; id: string; delta: string }
  | { type: 'message.assistant.reasoning.delta'; id: string; delta: string }
  | {
      type: 'message.assistant';
      id: string;
      content: string;
      reasoning?: string;
      sources?: EveSource[];
      tools?: EveToolTrace[];
    }
  | { type: 'tool.start'; id: string; name: string; args?: unknown }
  | { type: 'tool.end'; id: string; name: string; result?: unknown }
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
  | { type: 'done'; aborted?: boolean };

function authHeaders(token: string | undefined): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function base(): { baseUrl: string; token?: string } {
  if (typeof window === 'undefined') {
    throw new Error('eve client requires browser');
  }
  const w = window as Window & { EVE_BASE_URL?: string; EVE_LOOPBACK_TOKEN?: string };
  const baseUrl = (w.EVE_BASE_URL || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('EVE_BASE_URL not set');
  return { baseUrl, token: w.EVE_LOOPBACK_TOKEN };
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

export async function* streamEveTurn(
  sessionId: string,
  message: string,
  signal?: AbortSignal,
  options?: { thinkingMode?: ThinkingMode },
): AsyncGenerator<EveStreamEvent> {
  const { baseUrl, token } = base();
  const thinkingMode = options?.thinkingMode === 'think' ? 'think' : 'fast';
  const res = await eveFetch(`${baseUrl}/eve/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ message, thinkingMode }),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`turn failed: ${res.status} ${detail}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line) as EveStreamEvent;
      nl = buffer.indexOf('\n');
    }
  }
  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as EveStreamEvent;
}
