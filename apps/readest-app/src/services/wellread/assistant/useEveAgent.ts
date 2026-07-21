'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createEveSession,
  getEveSession,
  streamEveTurn,
  type EveMessage,
  type EveToolTrace,
  type ThinkingMode,
} from './eveClient';
import { formatPendingQuotesForTurn } from './helpers';
import type { PendingQuote } from './readingAssistantStore';

export type UseEveAgentStatus = 'ready' | 'submitted' | 'streaming' | 'error';

export type UseEveAgentOptions = {
  bookId: string;
  bookTitle?: string;
  sessionId?: string | null;
  /** Composer Thinking Mode for the next turn (default fast). */
  thinkingMode?: ThinkingMode;
};

export type SendTurnInput = {
  message?: string;
  /** Pending Quotes to attach to this user turn (cleared by caller before/on send). */
  quotes?: PendingQuote[];
  /** Restore quotes if the turn fails before/during stream. */
  onSendFailed?: (quotes: PendingQuote[]) => void;
};

/**
 * Lightweight useEveAgent-shaped hook over the wellread eve-compatible sidecar.
 */
export function useEveAgent(options: UseEveAgentOptions) {
  const { bookId, bookTitle, sessionId } = options;
  const thinkingMode: ThinkingMode = options.thinkingMode === 'think' ? 'think' : 'fast';
  const [messages, setMessages] = useState<EveMessage[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionId ?? null);
  const [status, setStatus] = useState<UseEveAgentStatus>('ready');
  const [error, setError] = useState<Error | null>(null);
  const [composer, setComposer] = useState('');
  const [inFlightTools, setInFlightTools] = useState<EveToolTrace[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Stay session-less until the user sends (or an id is provided).
      // Auto-creating on mount orphans empty "Chat about …" rows whenever
      // Chat History clears the active session and the chat pane remounts.
      if (!sessionId) {
        setActiveSessionId(null);
        setMessages([]);
        return;
      }
      try {
        const session = await getEveSession(sessionId);
        if (cancelled) return;
        setActiveSessionId(session.id);
        setMessages(session.messages);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, bookTitle, sessionId]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setInFlightTools([]);
    setStatus('ready');
  }, []);

  const send = useCallback(
    async (input?: SendTurnInput) => {
      const text = (input?.message ?? composer).trim();
      if (!text) return;
      if (status === 'submitted' || status === 'streaming') return;

      const quotes = input?.quotes ?? [];
      const wireText = formatPendingQuotesForTurn(quotes, text);
      const displayContent = text;

      let sessionIdForTurn = activeSessionId;
      if (!sessionIdForTurn) {
        try {
          const session = await createEveSession({
            bookId,
            bookTitle,
            title: bookTitle ? `Chat about ${bookTitle}` : undefined,
          });
          sessionIdForTurn = session.id;
          setActiveSessionId(session.id);
          setMessages(session.messages);
          setStatus('ready');
        } catch (err) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setStatus('error');
          input?.onSendFailed?.(quotes);
          return;
        }
      }

      const optimisticUserId = `optimistic-user-${Date.now()}`;
      const optimisticQuotes = quotes.length
        ? quotes.map((q) => ({
            text: q.text,
            chapterTitle: q.chapterTitle,
          }))
        : undefined;

      setError(null);
      setInFlightTools([]);
      setStatus('submitted');
      setComposer('');
      setMessages((prev) => [
        ...prev,
        {
          id: optimisticUserId,
          role: 'user',
          content: displayContent,
          createdAt: Date.now(),
          ...(optimisticQuotes ? { quotes: optimisticQuotes } : {}),
        },
      ]);

      const controller = new AbortController();
      abortRef.current = controller;

      let assistantId: string | null = null;
      let tools: EveToolTrace[] = [];
      let userCommitted = false;

      try {
        for await (const event of streamEveTurn(sessionIdForTurn, wireText, controller.signal, {
          thinkingMode,
        })) {
          if (event.type === 'message.user') {
            userCommitted = true;
            setMessages((prev) => {
              const withoutOptimistic = prev.filter((m) => m.id !== optimisticUserId);
              if (withoutOptimistic.some((m) => m.id === event.id)) return withoutOptimistic;
              return [
                ...withoutOptimistic,
                {
                  id: event.id,
                  role: 'user',
                  content: displayContent,
                  createdAt: Date.now(),
                  ...(optimisticQuotes ? { quotes: optimisticQuotes } : {}),
                },
              ];
            });
            setStatus('streaming');
          } else if (event.type === 'tool.start' || event.type === 'tool.end') {
            if (event.type === 'tool.start') {
              tools = [...tools, { id: event.id, name: event.name, args: event.args }];
            } else {
              tools = tools.map((t) => (t.id === event.id ? { ...t, result: event.result } : t));
            }
            setInFlightTools(tools);
          } else if (event.type === 'message.assistant.reasoning.delta') {
            assistantId = event.id;
            setMessages((prev) => {
              const existing = prev.find((m) => m.id === event.id);
              if (!existing) {
                return [
                  ...prev,
                  {
                    id: event.id,
                    role: 'assistant',
                    content: '',
                    reasoning: event.delta,
                    createdAt: Date.now(),
                    tools: tools.length ? tools : undefined,
                  },
                ];
              }
              return prev.map((m) =>
                m.id === event.id ? { ...m, reasoning: (m.reasoning ?? '') + event.delta } : m,
              );
            });
          } else if (event.type === 'message.assistant.delta') {
            assistantId = event.id;
            setMessages((prev) => {
              const existing = prev.find((m) => m.id === event.id);
              if (!existing) {
                return [
                  ...prev,
                  {
                    id: event.id,
                    role: 'assistant',
                    content: event.delta,
                    createdAt: Date.now(),
                    tools: tools.length ? tools : undefined,
                  },
                ];
              }
              return prev.map((m) =>
                m.id === event.id ? { ...m, content: m.content + event.delta } : m,
              );
            });
          } else if (event.type === 'message.assistant') {
            assistantId = event.id;
            setMessages((prev) => {
              const without = prev.filter((m) => m.id !== event.id);
              return [
                ...without,
                {
                  id: event.id,
                  role: 'assistant',
                  content: event.content,
                  reasoning: event.reasoning,
                  createdAt: Date.now(),
                  sources: event.sources,
                  tools: event.tools ?? (tools.length ? tools : undefined),
                },
              ];
            });
          } else if (event.type === 'context.compressed') {
            setMessages((prev) => {
              const removed = new Set(event.removedIds);
              removed.add(optimisticUserId);
              const kept = prev.filter((m) => !removed.has(m.id));
              return [
                {
                  id: event.summary.id,
                  role: event.summary.role,
                  content: event.summary.content,
                  createdAt: event.summary.createdAt,
                  compacted: true,
                },
                ...kept,
              ];
            });
          } else if (event.type === 'error') {
            throw new Error(event.message);
          } else if (event.type === 'done') {
            setInFlightTools([]);
            setStatus('ready');
          }
        }
        if (assistantId === null) {
          setInFlightTools([]);
          setStatus('ready');
        }
      } catch (err) {
        setInFlightTools([]);
        if ((err as Error).name === 'AbortError') {
          // Stop streaming: do not roll back the submitted user turn / quotes.
          setStatus('ready');
          return;
        }
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
        // Only restore the live bar if the user turn never landed (AC1.5).
        if (!userCommitted) {
          input?.onSendFailed?.(quotes);
        }
      } finally {
        abortRef.current = null;
      }
    },
    [activeSessionId, bookId, bookTitle, composer, status, thinkingMode],
  );

  const reset = useCallback(() => {
    stop();
    setMessages([]);
    setActiveSessionId(null);
    setStatus('ready');
    setError(null);
    setInFlightTools([]);
  }, [stop]);

  return {
    messages,
    sessionId: activeSessionId,
    status,
    error,
    composer,
    setComposer,
    inFlightTools,
    send,
    stop,
    reset,
  };
}
