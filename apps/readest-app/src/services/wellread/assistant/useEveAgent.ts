'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { eventDispatcher } from '@/utils/event';
import { stubTranslation as _ } from '@/utils/misc';
import type { SessionToolTrace } from '@wellread/eve-message';
import type { ReaderState } from '@wellread/reading-context';
import { formatPendingQuotesForTurn } from '@wellread/quote-wire';
import {
  createEveSession,
  getEveSession,
  normalizeEveMessage,
  streamEveTurn,
  uiMessageToEveMessage,
  type EveMessage,
  type EveStreamEvent,
  type ThinkingMode,
} from './eveClient';
import { hydrateEveMessagesForDisplay } from './quoteWire';
import type { PendingQuote } from './readingAssistantStore';
import {
  isTurnInFlightError,
  TURN_IN_FLIGHT_RETRIES,
  TURN_IN_FLIGHT_RETRY_MS,
} from './turnLifecycle';

function toolsInFlightFromMessage(msg: EveMessage): SessionToolTrace[] {
  const tools = msg.tools ?? [];
  return tools.filter((t) => t.result === undefined);
}

function hydrateMessages(messages: EveMessage[]): EveMessage[] {
  return hydrateEveMessagesForDisplay(messages).map(normalizeEveMessage);
}

async function* streamEveTurnRetrying(
  sessionId: string,
  message: string,
  signal: AbortSignal,
  options: {
    thinkingMode: ThinkingMode;
    readerState?: ReaderState | null;
  },
): AsyncGenerator<EveStreamEvent> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= TURN_IN_FLIGHT_RETRIES; attempt++) {
    if (signal.aborted) {
      const err = new Error('Request cancelled');
      err.name = 'AbortError';
      throw err;
    }
    try {
      yield* streamEveTurn(sessionId, message, signal, options);
      return;
    } catch (err) {
      lastError = err;
      if (!isTurnInFlightError(err) || attempt === TURN_IN_FLIGHT_RETRIES) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, TURN_IN_FLIGHT_RETRY_MS * (attempt + 1)));
    }
  }
  throw lastError;
}

export type UseEveAgentStatus = 'ready' | 'submitted' | 'streaming' | 'error';

export type UseEveAgentOptions = {
  bookId: string;
  bookTitle?: string;
  sessionId?: string | null;
  /** Composer Thinking Mode for the next turn (default fast). */
  thinkingMode?: ThinkingMode;
  /** Optional snapshot of the reader's current chapter/CFI for this turn. */
  getReaderState?: () => ReaderState | null | undefined;
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
  const [inFlightTools, setInFlightTools] = useState<SessionToolTrace[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  /** In-flight send promise — Stop → resend awaits teardown before the next POST. */
  const turnPromiseRef = useRef<Promise<void> | null>(null);
  /** True after Stop until the aborted turn fully settles. */
  const stoppingRef = useRef(false);
  /** Mirrors activeSessionId for async reconcile — ignore stale disk loads after switch. */
  const activeSessionIdRef = useRef<string | null>(sessionId ?? null);
  /** Session this hook instance created during send — skip disk reload for that id. */
  const createdSessionIdRef = useRef<string | null>(null);
  const loadedSessionIdRef = useRef<string | null | undefined>(undefined);
  /** Always call latest getReaderState without putting it in sendTurn deps. */
  const getReaderStateRef = useRef(getReaderState);
  useEffect(() => {
    getReaderStateRef.current = getReaderState;
  });

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
          stoppingRef.current = true;
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
        stoppingRef.current = true;
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
        setMessages(hydrateMessages(session.messages));
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
    if (!turnPromiseRef.current) {
      setInFlightTools([]);
      setError(null);
      setStatus('ready');
      return;
    }
    stoppingRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    setInFlightTools([]);
    setError(null);
    // Keep UI composable; send() awaits turnPromiseRef before the next POST.
    setStatus('ready');
  }, []);

  const reconcileFromDisk = useCallback(async (id: string) => {
    try {
      const session = await getEveSession(id);
      // History / New chat may have moved on while this fetch was in flight.
      if (activeSessionIdRef.current !== id) return;
      setMessages(hydrateMessages(session.messages));
    } catch {
      // Keep local messages if refetch fails; disk remains source of truth on reopen.
    }
  }, []);

  const send = useCallback(
    async (input?: SendTurnInput) => {
      const text = (input?.message ?? composer).trim();
      if (!text) return;

      // Genuine double-send while a turn is active (not Stop → resend).
      if (turnPromiseRef.current && !stoppingRef.current) return;

      const quotes = input?.quotes ?? [];
      const wireText = formatPendingQuotesForTurn(quotes, text);
      const displayContent = text;

      const prior = turnPromiseRef.current;
      const turn = (async () => {
        if (prior) await prior.catch(() => {});
        stoppingRef.current = false;

        let sessionIdForTurn = activeSessionIdRef.current;
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
        let userCommitted = false;
        let needsReconcile = false;

        try {
          const readerState = getReaderStateRef.current?.() ?? undefined;
          for await (const event of streamEveTurnRetrying(
            sessionIdForTurn,
            wireText,
            controller.signal,
            {
              thinkingMode,
              readerState: readerState ?? undefined,
            },
          )) {
            // First streamed event means the server accepted the turn (user committed).
            if (!userCommitted) {
              userCommitted = true;
              setStatus('streaming');
            }
            if (event.type === 'ui-message') {
              if (event.message.role !== 'assistant') continue;
              const eveMsg = uiMessageToEveMessage(event.message);
              assistantId = eveMsg.id;
              setInFlightTools(toolsInFlightFromMessage(eveMsg));
              setMessages((prev) => {
                const withoutAssistant = prev.filter((m) => m.id !== eveMsg.id);
                return [...withoutAssistant, eveMsg];
              });
            } else if (event.type === 'context.compressed') {
              // Keep the optimistic user bubble through the rest of the stream;
              // reconcileFromDisk swaps it for the server user id when the turn ends.
              setMessages((prev) => {
                const removed = new Set(event.removedIds);
                const kept = prev.filter((m) => !removed.has(m.id));
                return [
                  normalizeEveMessage({
                    id: event.summary.id,
                    role: event.summary.role,
                    content: event.summary.content,
                    createdAt: event.summary.createdAt,
                    compacted: true,
                  }),
                  ...kept,
                ];
              });
            } else if (event.type === 'context.compress_failed') {
              if (event.message) {
                console.warn('[eve] context.compress_failed:', event.message);
              }
              eventDispatcher.dispatch('toast', {
                type: 'warning',
                message: _("Couldn't compress chat history; continuing with full context"),
              });
            } else if (event.type === 'error') {
              throw new Error(event.message);
            } else if (event.type === 'abort') {
              needsReconcile = true;
            }
          }
          setInFlightTools([]);
          setStatus('ready');
          if (needsReconcile) {
            const dropIds = new Set([optimisticUserId, assistantId].filter(Boolean) as string[]);
            setMessages((prev) => prev.filter((m) => !dropIds.has(m.id)));
            await reconcileFromDisk(sessionIdForTurn);
          } else {
            // Resolve optimistic user id / sources from disk after a successful turn.
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
            const dropIds = new Set([optimisticUserId, assistantId].filter(Boolean) as string[]);
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
      })();

      turnPromiseRef.current = turn;
      try {
        await turn;
      } finally {
        if (turnPromiseRef.current === turn) {
          turnPromiseRef.current = null;
        }
      }
    },
    [bookId, bookTitle, composer, reconcileFromDisk, thinkingMode],
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
