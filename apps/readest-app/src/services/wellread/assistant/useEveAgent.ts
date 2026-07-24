'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { eventDispatcher } from '@/utils/event';
import { stubTranslation as _ } from '@/utils/misc';
import {
  createEveSession,
  getEveSession,
  streamEveTurn,
  type EveMessage,
  type EveReaderState,
  type EveToolTrace,
  type ThinkingMode,
} from './eveClient';
import { formatPendingQuotesForTurn, hydrateEveMessagesForDisplay } from './helpers';
import type { PendingQuote } from './readingAssistantStore';

export type UseEveAgentStatus = 'ready' | 'submitted' | 'streaming' | 'error';

export type UseEveAgentOptions = {
  bookId: string;
  bookTitle?: string;
  sessionId?: string | null;
  /** Composer Thinking Mode for the next turn (default fast). */
  thinkingMode?: ThinkingMode;
  /** Optional snapshot of the reader's current chapter/CFI for this turn. */
  getReaderState?: () => EveReaderState | null | undefined;
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
  const { bookId, bookTitle, sessionId, getReaderState } = options;
  const thinkingMode: ThinkingMode = options.thinkingMode === 'think' ? 'think' : 'fast';
  const [messages, setMessages] = useState<EveMessage[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionId ?? null);
  const [status, setStatus] = useState<UseEveAgentStatus>('ready');
  const [error, setError] = useState<Error | null>(null);
  const [composer, setComposer] = useState('');
  const [inFlightTools, setInFlightTools] = useState<EveToolTrace[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  /** Mirrors activeSessionId for async reconcile — ignore stale disk loads after switch. */
  const activeSessionIdRef = useRef<string | null>(sessionId ?? null);
  /** Session this hook instance created during send — skip disk reload for that id. */
  const createdSessionIdRef = useRef<string | null>(null);
  const loadedSessionIdRef = useRef<string | null | undefined>(undefined);
  /** Always call latest getReaderState without putting it in sendTurn deps. */
  const getReaderStateRef = useRef(getReaderState);
  getReaderStateRef.current = getReaderState;

  useEffect(() => {
    let cancelled = false;
    const sessionChanged = loadedSessionIdRef.current !== sessionId;
    loadedSessionIdRef.current = sessionId;
    // Sync before any await so in-flight reconcileFromDisk cannot win a race
    // against New chat / History (sessionId → null or another id).
    if (sessionChanged) {
      activeSessionIdRef.current = sessionId ?? null;
    }

    (async () => {
      // Stay session-less until the user sends (or an id is provided).
      // Auto-creating on mount orphans empty "Chat about …" rows whenever
      // Chat History clears the active session and the chat pane remounts.
      if (!sessionId) {
        createdSessionIdRef.current = null;
        if (sessionChanged) {
          abortRef.current?.abort();
          abortRef.current = null;
          setInFlightTools([]);
          setError(null);
          setStatus('ready');
        }
        setActiveSessionId(null);
        setMessages([]);
        return;
      }
      // Parent synced the id we just created (store ← agent.sessionId). Disk is
      // still empty until the turn finishes — do not wipe in-flight messages.
      if (sessionId === createdSessionIdRef.current) {
        setActiveSessionId(sessionId);
        return;
      }
      // History / New chat: drop any in-flight turn so its deltas cannot
      // overwrite the session we are about to load.
      if (sessionChanged) {
        createdSessionIdRef.current = null;
        abortRef.current?.abort();
        abortRef.current = null;
        setInFlightTools([]);
        setError(null);
        setStatus('ready');
      }
      try {
        const session = await getEveSession(sessionId);
        if (cancelled) return;
        activeSessionIdRef.current = session.id;
        setActiveSessionId(session.id);
        setMessages(hydrateEveMessagesForDisplay(session.messages));
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
    setError(null);
    setStatus('ready');
  }, []);

  const reconcileFromDisk = useCallback(async (id: string) => {
    try {
      const session = await getEveSession(id);
      // History / New chat may have moved on while this fetch was in flight.
      if (activeSessionIdRef.current !== id) return;
      setMessages(hydrateEveMessagesForDisplay(session.messages));
    } catch {
      // Keep local messages if refetch fails; disk remains source of truth on reopen.
    }
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
          createdSessionIdRef.current = session.id;
          activeSessionIdRef.current = session.id;
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
      let committedUserId: string | null = null;
      let needsReconcile = false;

      try {
        const readerState = getReaderStateRef.current?.() ?? undefined;
        for await (const event of streamEveTurn(sessionIdForTurn, wireText, controller.signal, {
          thinkingMode,
          readerState: readerState ?? undefined,
        })) {
          if (event.type === 'message.user') {
            userCommitted = true;
            committedUserId = event.id;
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
          } else if (event.type === 'context.compress_failed') {
            // Soft failure: session unchanged; turn continues on the server.
            // Keep agent.error / status for hard turn failures only.
            if (event.message) {
              console.warn('[eve] context.compress_failed:', event.message);
            }
            eventDispatcher.dispatch('toast', {
              type: 'warning',
              message: _("Couldn't compress chat history; continuing with full context"),
            });
          } else if (event.type === 'error') {
            throw new Error(event.message);
          } else if (event.type === 'done') {
            setInFlightTools([]);
            setStatus('ready');
            if (event.aborted) {
              needsReconcile = true;
            }
          }
        }
        if (assistantId === null) {
          setInFlightTools([]);
          setStatus('ready');
        }
        if (needsReconcile) {
          await reconcileFromDisk(sessionIdForTurn);
        }
      } catch (err) {
        setInFlightTools([]);
        // Tauri plugin-http aborts as Error('Request cancelled'), not AbortError.
        // Prefer the controller we own so Stop never falls into reconcileFromDisk.
        const aborted =
          controller.signal.aborted ||
          (err as Error).name === 'AbortError' ||
          (err instanceof Error && err.message === 'Request cancelled');
        if (aborted) {
          // Mirror server rollback locally. Do not refetch here: Stop aborts the
          // fetch before the server may have re-persisted after dropInFlightUser,
          // and a stale getEveSession would resurrect the unanswered user.
          const dropIds = new Set(
            [optimisticUserId, committedUserId, assistantId].filter(Boolean) as string[],
          );
          setMessages((prev) => prev.filter((m) => !dropIds.has(m.id)));
          setStatus('ready');
          return;
        }
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
        // Only restore the live bar if the user turn never landed (AC1.5).
        if (!userCommitted) {
          input?.onSendFailed?.(quotes);
        }
        await reconcileFromDisk(sessionIdForTurn);
      } finally {
        abortRef.current = null;
        // Allow later prop-driven reloads of this session (e.g. bookTitle change).
        if (createdSessionIdRef.current === sessionIdForTurn) {
          createdSessionIdRef.current = null;
        }
      }
    },
    [activeSessionId, bookId, bookTitle, composer, reconcileFromDisk, status, thinkingMode],
  );

  const reset = useCallback(() => {
    stop();
    createdSessionIdRef.current = null;
    activeSessionIdRef.current = null;
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
