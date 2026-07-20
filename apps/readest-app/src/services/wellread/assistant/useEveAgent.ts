'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createEveSession,
  getEveSession,
  streamEveTurn,
  type EveMessage,
  type EveToolTrace,
} from './eveClient';

export type UseEveAgentStatus = 'ready' | 'submitted' | 'streaming' | 'error';

export type UseEveAgentOptions = {
  bookId: string;
  bookTitle?: string;
  sessionId?: string | null;
  /** Composer draft set by ask-about; cleared by caller after send if desired. */
  draft?: string;
  onDraftConsumed?: () => void;
};

/**
 * Lightweight useEveAgent-shaped hook over the wellread eve-compatible sidecar.
 */
export function useEveAgent(options: UseEveAgentOptions) {
  const { bookId, bookTitle, sessionId } = options;
  const [messages, setMessages] = useState<EveMessage[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionId ?? null);
  const [status, setStatus] = useState<UseEveAgentStatus>('ready');
  const [error, setError] = useState<Error | null>(null);
  const [composer, setComposer] = useState(options.draft ?? '');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (options.draft !== undefined) {
      setComposer(options.draft);
    }
  }, [options.draft]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (sessionId) {
          const session = await getEveSession(sessionId);
          if (cancelled) return;
          setActiveSessionId(session.id);
          setMessages(session.messages);
          return;
        }
        const session = await createEveSession({
          bookId,
          bookTitle,
          title: bookTitle ? `Chat about ${bookTitle}` : undefined,
        });
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
    setStatus('ready');
  }, []);

  const send = useCallback(
    async (input?: { message?: string }) => {
      const text = (input?.message ?? composer).trim();
      if (!text || !activeSessionId) return;
      if (status === 'submitted' || status === 'streaming') return;

      setError(null);
      setStatus('submitted');
      setComposer('');
      options.onDraftConsumed?.();

      const controller = new AbortController();
      abortRef.current = controller;

      let assistantId: string | null = null;
      let tools: EveToolTrace[] = [];

      try {
        for await (const event of streamEveTurn(activeSessionId, text, controller.signal)) {
          if (event.type === 'message.user') {
            setMessages((prev) => [
              ...prev,
              {
                id: event.id,
                role: 'user',
                content: event.content,
                createdAt: Date.now(),
              },
            ]);
            setStatus('streaming');
          } else if (event.type === 'tool.start' || event.type === 'tool.end') {
            if (event.type === 'tool.start') {
              tools = [...tools, { id: event.id, name: event.name, args: event.args }];
            } else {
              tools = tools.map((t) => (t.id === event.id ? { ...t, result: event.result } : t));
            }
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
                  createdAt: Date.now(),
                  sources: event.sources,
                  tools: event.tools ?? (tools.length ? tools : undefined),
                },
              ];
            });
          } else if (event.type === 'error') {
            throw new Error(event.message);
          } else if (event.type === 'done') {
            setStatus('ready');
          }
        }
        if (assistantId === null) setStatus('ready');
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          setStatus('ready');
          return;
        }
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      } finally {
        abortRef.current = null;
      }
    },
    [activeSessionId, composer, options, status],
  );

  const reset = useCallback(() => {
    stop();
    setMessages([]);
    setActiveSessionId(null);
    setStatus('ready');
    setError(null);
  }, [stop]);

  return {
    messages,
    sessionId: activeSessionId,
    status,
    error,
    composer,
    setComposer,
    send,
    stop,
    reset,
  };
}
