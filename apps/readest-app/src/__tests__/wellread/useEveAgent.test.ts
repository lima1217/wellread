import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { eventDispatcher } from '@/utils/event';

const createEveSession = vi.fn();
const getEveSession = vi.fn();
const streamEveTurn = vi.fn();

vi.mock('@/services/wellread/assistant/eveClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/wellread/assistant/eveClient')>();
  return {
    ...actual,
    createEveSession: (...args: unknown[]) => createEveSession(...args),
    getEveSession: (...args: unknown[]) => getEveSession(...args),
    streamEveTurn: (...args: unknown[]) => streamEveTurn(...args),
  };
});

import { useEveAgent } from '@/services/wellread/assistant/useEveAgent';

type UiPart = Record<string, unknown>;

function assistantUi(
  id: string,
  parts: UiPart[],
): { type: 'ui-message'; message: { id: string; role: 'assistant'; parts: UiPart[] } } {
  return { type: 'ui-message', message: { id, role: 'assistant', parts } };
}

function textPart(text: string): UiPart {
  return { type: 'text', text, state: 'done' };
}

function reasoningPart(text: string): UiPart {
  return { type: 'reasoning', text, state: 'done' };
}

function toolPart(toolCallId: string, toolName: string, input: unknown, output?: unknown): UiPart {
  if (output === undefined) {
    return { type: 'dynamic-tool', toolCallId, toolName, state: 'input-available', input };
  }
  return {
    type: 'dynamic-tool',
    toolCallId,
    toolName,
    state: 'output-available',
    input,
    output,
  };
}

function sessionMeta(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    bookId: 'book-1',
    title: 'Chat',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('useEveAgent', () => {
  beforeEach(() => {
    createEveSession.mockReset();
    getEveSession.mockReset();
    streamEveTurn.mockReset();
  });

  it('does not create a session on mount when sessionId is null', async () => {
    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: null }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(createEveSession).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBeNull();
    expect(result.current.messages).toEqual([]);
  });

  it('loads an existing session when sessionId is provided', async () => {
    getEveSession.mockResolvedValue({
      id: 'ses_existing',
      bookId: 'book-1',
      title: 'Chat about Middlemarch',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: 'm1', role: 'user', content: 'hello', createdAt: 1 }],
    });

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: 'ses_existing' }),
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(createEveSession).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBe('ses_existing');
  });

  it('hydrates Pending Quotes from wire content when opening Chat History', async () => {
    getEveSession.mockResolvedValue({
      id: 'ses_history',
      bookId: 'book-1',
      title: 'Why did he stop?',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: '> But back to Hardy.\n\nWhy did he stop?',
          createdAt: 1,
        },
      ],
    });

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: 'ses_history' }),
    );

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        expect.objectContaining({
          id: 'u1',
          role: 'user',
          content: 'Why did he stop?',
          createdAt: 1,
          quotes: [{ text: 'But back to Hardy.', chapterTitle: null }],
        }),
      ]);
    });
  });

  it('creates a session lazily on first send when none is active', async () => {
    createEveSession.mockResolvedValue({
      id: 'ses_new',
      bookId: 'book-1',
      title: 'Chat about Middlemarch',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    });
    streamEveTurn.mockImplementation(async function* () {
      // Turn completes when the generator returns; reconcileFromDisk follows.
    });
    getEveSession.mockResolvedValue({
      ...sessionMeta('ses_new'),
      messages: [{ id: 'u1', role: 'user', content: 'What is vocation?', createdAt: 1 }],
    });

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: null }),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(createEveSession).not.toHaveBeenCalled();

    await act(async () => {
      result.current.setComposer('What is vocation?');
    });
    await act(async () => {
      await result.current.send();
    });

    expect(createEveSession).toHaveBeenCalledTimes(1);
    expect(result.current.sessionId).toBe('ses_new');
  });

  it('keeps in-flight messages when sessionId prop updates to the session created mid-send', async () => {
    createEveSession.mockResolvedValue({
      id: 'ses_new',
      bookId: 'book-1',
      title: 'Chat about Middlemarch',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    });
    // Disk still empty — turn has not finished saving yet.
    getEveSession.mockResolvedValue({
      id: 'ses_new',
      bookId: 'book-1',
      title: 'Chat about Middlemarch',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    streamEveTurn.mockImplementation(async function* () {
      yield assistantUi('a1', [textPart('Hello')]);
      await gate;
      yield assistantUi('a1', [textPart('Hello')]);
    });
    getEveSession.mockResolvedValue({
      ...sessionMeta('ses_new'),
      messages: [
        { id: 'u1', role: 'user', content: 'What is vocation?', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'Hello', createdAt: 2 },
      ],
    });

    const { result, rerender } = renderHook(
      ({ sessionId }) => useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId }),
      { initialProps: { sessionId: null as string | null } },
    );

    await act(async () => {
      result.current.setComposer('What is vocation?');
    });

    let sendDone: Promise<void> | undefined;
    await act(async () => {
      sendDone = result.current.send();
    });

    await waitFor(() => {
      expect(result.current.sessionId).toBe('ses_new');
      expect(result.current.messages.some((m) => m.role === 'user')).toBe(true);
    });

    // Parent synced store → prop (same id this instance just created).
    rerender({ sessionId: 'ses_new' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getEveSession).not.toHaveBeenCalled();
    expect(result.current.messages.some((m) => m.role === 'user')).toBe(true);
    expect(result.current.messages.some((m) => m.role === 'assistant')).toBe(true);

    release();
    await act(async () => {
      await sendDone;
    });

    expect(result.current.messages.find((m) => m.role === 'assistant')).toMatchObject({
      content: 'Hello',
    });
  });

  it('reloads messages when sessionId prop changes to a different session', async () => {
    getEveSession
      .mockResolvedValueOnce({
        id: 'ses_a',
        bookId: 'book-1',
        title: 'A',
        createdAt: 1,
        updatedAt: 1,
        messages: [{ id: 'a1', role: 'user', content: 'from A', createdAt: 1 }],
      })
      .mockResolvedValueOnce({
        id: 'ses_b',
        bookId: 'book-1',
        title: 'B',
        createdAt: 2,
        updatedAt: 2,
        messages: [{ id: 'b1', role: 'user', content: 'from B', createdAt: 2 }],
      });

    const { result, rerender } = renderHook(
      ({ sessionId }) => useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId }),
      { initialProps: { sessionId: 'ses_a' } },
    );

    await waitFor(() => {
      expect(result.current.messages[0]?.content).toBe('from A');
    });

    rerender({ sessionId: 'ses_b' });

    await waitFor(() => {
      expect(result.current.messages[0]?.content).toBe('from B');
    });
  });

  it('aborts an in-flight turn when sessionId switches to another session', async () => {
    getEveSession
      .mockResolvedValueOnce({
        id: 'ses_a',
        bookId: 'book-1',
        title: 'A',
        createdAt: 1,
        updatedAt: 1,
        messages: [],
      })
      .mockResolvedValueOnce({
        id: 'ses_b',
        bookId: 'book-1',
        title: 'B',
        createdAt: 2,
        updatedAt: 2,
        messages: [{ id: 'b1', role: 'user', content: 'from B', createdAt: 2 }],
      });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    streamEveTurn.mockImplementation(async function* (_id, _text, signal: AbortSignal) {
      yield assistantUi('a1', [textPart('partial')]);
      await gate;
      if (signal.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
    });

    const { result, rerender } = renderHook(
      ({ sessionId }) => useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId }),
      { initialProps: { sessionId: 'ses_a' } },
    );
    await waitFor(() => {
      expect(result.current.sessionId).toBe('ses_a');
    });

    await act(async () => {
      result.current.setComposer('streaming…');
    });
    let sendDone: Promise<void> | undefined;
    await act(async () => {
      sendDone = result.current.send();
    });
    await waitFor(() => {
      expect(result.current.messages.some((m) => m.role === 'assistant')).toBe(true);
    });

    rerender({ sessionId: 'ses_b' });
    release();
    await act(async () => {
      await sendDone;
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        expect.objectContaining({ id: 'b1', content: 'from B' }),
      ]);
    });
    expect(result.current.status).toBe('ready');
  });

  it('wires Pending Quotes into the turn text and skips restore after user commit', async () => {
    getEveSession
      .mockResolvedValueOnce({
        id: 'ses_existing',
        bookId: 'book-1',
        title: 'Chat',
        createdAt: 1,
        updatedAt: 1,
        messages: [],
      })
      .mockResolvedValueOnce({
        id: 'ses_existing',
        bookId: 'book-1',
        title: 'Chat',
        createdAt: 1,
        updatedAt: 1,
        messages: [],
      });
    streamEveTurn.mockImplementation(async function* () {
      yield { type: 'error' as const, message: 'boom' };
    });
    const onSendFailed = vi.fn();

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: 'ses_existing' }),
    );
    await waitFor(() => {
      expect(result.current.sessionId).toBe('ses_existing');
    });

    await act(async () => {
      result.current.setComposer('Why?');
    });
    await act(async () => {
      await result.current.send({
        quotes: [{ id: 'q1', text: 'quoted', chapterTitle: null }],
        onSendFailed,
      });
    });

    expect(streamEveTurn).toHaveBeenCalledWith(
      'ses_existing',
      '> quoted\n\nWhy?',
      expect.any(AbortSignal),
      { thinkingMode: 'fast' },
    );
    // Disk rolled back the failed turn; UI reconciles to match.
    expect(result.current.messages).toEqual([]);
    expect(onSendFailed).not.toHaveBeenCalled();
  });

  it('restores Pending Quotes when session create fails before commit', async () => {
    createEveSession.mockRejectedValue(new Error('offline'));
    const onSendFailed = vi.fn();
    const quotes = [{ id: 'q1', text: 'quoted', chapterTitle: null }];

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: null }),
    );

    await act(async () => {
      result.current.setComposer('Why?');
    });
    await act(async () => {
      await result.current.send({ quotes, onSendFailed });
    });

    expect(onSendFailed).toHaveBeenCalledWith(quotes);
    expect(streamEveTurn).not.toHaveBeenCalled();
  });

  it('does not send when composer text is empty even if Pending Quotes exist', async () => {
    const onSendFailed = vi.fn();
    const quotes = [{ id: 'q1', text: 'quoted', chapterTitle: null }];

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: null }),
    );

    await act(async () => {
      result.current.setComposer('   ');
    });
    await act(async () => {
      await result.current.send({ quotes, onSendFailed });
    });

    expect(createEveSession).not.toHaveBeenCalled();
    expect(streamEveTurn).not.toHaveBeenCalled();
    expect(onSendFailed).not.toHaveBeenCalled();
  });

  it('shows an optimistic user message before the first stream event, then replaces it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    streamEveTurn.mockImplementation(async function* () {
      await gate;
      yield* [] as Array<{ type: 'abort' }>;
    });
    getEveSession
      .mockResolvedValueOnce({
        ...sessionMeta('ses_existing'),
        messages: [],
      })
      .mockResolvedValueOnce({
        ...sessionMeta('ses_existing'),
        messages: [{ id: 'u1', role: 'user', content: 'What is vocation?', createdAt: 1 }],
      });

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: 'ses_existing' }),
    );
    await waitFor(() => {
      expect(result.current.sessionId).toBe('ses_existing');
    });

    await act(async () => {
      result.current.setComposer('What is vocation?');
    });

    let sendDone: Promise<void> | undefined;
    await act(async () => {
      sendDone = result.current.send();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('submitted');
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: 'What is vocation?',
    });
    expect(result.current.messages[0]?.id).toMatch(/^optimistic-user-/);

    release();
    await act(async () => {
      await sendDone;
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      id: 'u1',
      role: 'user',
      content: 'What is vocation?',
    });
  });

  it('passes Think mode and accumulates reasoning separate from content', async () => {
    getEveSession.mockResolvedValue({
      id: 'ses_existing',
      bookId: 'book-1',
      title: 'Chat',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    });
    streamEveTurn.mockImplementation(async function* () {
      yield assistantUi('a1', [reasoningPart('step ')]);
      yield assistantUi('a1', [reasoningPart('step two')]);
      yield assistantUi('a1', [reasoningPart('step two'), textPart('Because vocation.')]);
    });
    getEveSession
      .mockResolvedValueOnce({
        ...sessionMeta('ses_existing'),
        messages: [],
      })
      .mockResolvedValueOnce({
        ...sessionMeta('ses_existing'),
        messages: [
          { id: 'u1', role: 'user', content: 'Why?', createdAt: 1 },
          {
            id: 'a1',
            role: 'assistant',
            content: 'Because vocation.',
            reasoning: 'step two',
            createdAt: 2,
          },
        ],
      });

    const { result } = renderHook(() =>
      useEveAgent({
        bookId: 'book-1',
        bookTitle: 'Middlemarch',
        sessionId: 'ses_existing',
        thinkingMode: 'think',
      }),
    );
    await waitFor(() => {
      expect(result.current.sessionId).toBe('ses_existing');
    });

    await act(async () => {
      result.current.setComposer('Why?');
    });
    await act(async () => {
      await result.current.send();
    });

    expect(streamEveTurn).toHaveBeenCalledWith('ses_existing', 'Why?', expect.any(AbortSignal), {
      thinkingMode: 'think',
    });
    const assistant = result.current.messages.find((m) => m.role === 'assistant');
    expect(assistant).toMatchObject({
      content: 'Because vocation.',
      reasoning: 'step two',
    });
  });

  it('exposes in-flight tools before assistant text arrives and clears them when done', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    getEveSession
      .mockResolvedValueOnce({
        ...sessionMeta('ses_existing'),
        messages: [],
      })
      .mockResolvedValueOnce({
        ...sessionMeta('ses_existing'),
        messages: [
          { id: 'u1', role: 'user', content: 'Why?', createdAt: 1 },
          { id: 'a1', role: 'assistant', content: 'Because…', createdAt: 2 },
        ],
      });
    streamEveTurn.mockImplementation(async function* () {
      yield assistantUi('a1', [toolPart('t1', 'search_extract', { q: 'vocation' })]);
      await gate;
      yield assistantUi('a1', [
        toolPart('t1', 'search_extract', { q: 'vocation' }, { hits: 1 }),
        textPart('Because…'),
      ]);
    });

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: 'ses_existing' }),
    );
    await waitFor(() => {
      expect(result.current.sessionId).toBe('ses_existing');
    });

    await act(async () => {
      result.current.setComposer('Why?');
    });

    let sendDone: Promise<void> | undefined;
    await act(async () => {
      sendDone = result.current.send();
    });

    await waitFor(() => {
      expect(result.current.inFlightTools).toHaveLength(1);
    });
    expect(result.current.inFlightTools[0]).toMatchObject({
      id: 't1',
      name: 'search_extract',
    });

    release();
    await act(async () => {
      await sendDone;
    });

    expect(result.current.inFlightTools).toEqual([]);
    expect(result.current.status).toBe('ready');
  });

  it('applies context.compressed by dropping removed ids and prepending the summary', async () => {
    getEveSession
      .mockResolvedValueOnce({
        ...sessionMeta('ses_existing'),
        messages: [
          { id: 'old1', role: 'user', content: 'earlier', createdAt: 1 },
          { id: 'old2', role: 'assistant', content: 'reply', createdAt: 2 },
        ],
      })
      .mockResolvedValueOnce({
        ...sessionMeta('ses_existing'),
        messages: [
          {
            id: 'sum1',
            role: 'assistant',
            content: '[Conversation summary]\nPrior turns compacted.',
            createdAt: 3,
            compacted: true,
          },
          { id: 'u1', role: 'user', content: 'new question', createdAt: 4 },
        ],
      });
    streamEveTurn.mockImplementation(async function* () {
      yield {
        type: 'context.compressed' as const,
        beforeTokens: 900,
        afterTokens: 180,
        targetTokens: 200,
        removedIds: ['old1', 'old2'],
        summary: {
          id: 'sum1',
          role: 'assistant' as const,
          content: '[Conversation summary]\nPrior turns compacted.',
          createdAt: 3,
          compacted: true,
        },
      };
    });

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: 'ses_existing' }),
    );
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    await act(async () => {
      result.current.setComposer('new question');
    });
    await act(async () => {
      await result.current.send();
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        expect.objectContaining({
          id: 'sum1',
          compacted: true,
          content: '[Conversation summary]\nPrior turns compacted.',
        }),
        expect.objectContaining({ id: 'u1', role: 'user', content: 'new question' }),
      ]);
    });
  });

  it('toasts on context.compress_failed without aborting the turn', async () => {
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');
    getEveSession
      .mockResolvedValueOnce({
        ...sessionMeta('ses_existing'),
        messages: [{ id: 'old1', role: 'user', content: 'earlier', createdAt: 1 }],
      })
      .mockResolvedValueOnce({
        ...sessionMeta('ses_existing'),
        messages: [
          { id: 'old1', role: 'user', content: 'earlier', createdAt: 1 },
          { id: 'u1', role: 'user', content: 'new question', createdAt: 2 },
          { id: 'a1', role: 'assistant', content: 'still answering', createdAt: 3 },
        ],
      });
    streamEveTurn.mockImplementation(async function* () {
      yield {
        type: 'context.compress_failed' as const,
        message: 'summarizer down',
      };
      yield assistantUi('a1', [textPart('still answering')]);
    });

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: 'ses_existing' }),
    );
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    await act(async () => {
      result.current.setComposer('new question');
    });
    await act(async () => {
      await result.current.send();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(dispatchSpy).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({
        type: 'warning',
        message: "Couldn't compress chat history; continuing with full context",
      }),
    );
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('ready');
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'old1', role: 'user', content: 'earlier' }),
      expect.objectContaining({ id: 'u1', role: 'user', content: 'new question' }),
      expect.objectContaining({ id: 'a1', role: 'assistant', content: 'still answering' }),
    ]);
    dispatchSpy.mockRestore();
  });

  it('drops the in-flight turn locally after an AbortError', async () => {
    getEveSession.mockResolvedValue({
      id: 'ses_existing',
      bookId: 'book-1',
      title: 'Chat',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: 'kept', role: 'user', content: 'prior', createdAt: 1 }],
    });

    streamEveTurn.mockImplementation(async function* () {
      yield assistantUi('a1', [textPart('partial ')]);
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: 'ses_existing' }),
    );
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    await act(async () => {
      result.current.setComposer('stop me');
    });
    await act(async () => {
      await result.current.send();
    });

    // Mount load only — AbortError must not refetch (stale disk race).
    expect(getEveSession).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'kept', content: 'prior' }),
    ]);
    expect(result.current.status).toBe('ready');
  });

  it('drops the in-flight turn after Tauri Request cancelled (Stop)', async () => {
    getEveSession.mockResolvedValue({
      id: 'ses_existing',
      bookId: 'book-1',
      title: 'Chat',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: 'kept', role: 'user', content: 'prior', createdAt: 1 }],
    });

    streamEveTurn.mockImplementation(async function* (_sid, _msg, signal: AbortSignal) {
      yield assistantUi('a1', [textPart('partial ')]);
      // plugin-http shape: Error('Request cancelled'), name !== 'AbortError'.
      await new Promise<never>((_resolve, reject) => {
        const fail = () => reject(new Error('Request cancelled'));
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      });
    });

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: 'ses_existing' }),
    );
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    await act(async () => {
      result.current.setComposer('stop me');
    });

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = result.current.send();
    });
    await act(async () => {
      result.current.stop();
    });
    await act(async () => {
      await sendPromise;
    });

    expect(getEveSession).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'kept', content: 'prior' }),
    ]);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
  });

  it('does not surface empty-reply errors that arrive after Stop', async () => {
    getEveSession.mockResolvedValue({
      id: 'ses_existing',
      bookId: 'book-1',
      title: 'Chat',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: 'kept', role: 'assistant', content: 'prior', createdAt: 1 }],
    });

    streamEveTurn.mockImplementation(async function* (_sid, _msg, signal: AbortSignal) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
      // Buffered side-channel error from a misclassified server abort — must not stick as UI error.
      yield {
        type: 'error' as const,
        message:
          'Model returned an empty reply. Check API key/model. (No output generated. Check the stream for errors.)',
      };
    });

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: 'ses_existing' }),
    );
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    await act(async () => {
      result.current.setComposer('stop me');
    });

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = result.current.send();
    });
    await act(async () => {
      result.current.stop();
    });
    await act(async () => {
      await sendPromise;
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'kept', content: 'prior' }),
    ]);
  });

  it('ignores reconcileFromDisk after switching to another session', async () => {
    let resolveStale: (value: unknown) => void;
    const staleLoad = new Promise((resolve) => {
      resolveStale = resolve;
    });

    getEveSession.mockImplementation((id: string) => {
      if (id === 'ses_a') {
        // First call: mount load for A. Later: delayed error reconcile for A.
        if (getEveSession.mock.calls.filter((c) => c[0] === 'ses_a').length === 1) {
          return Promise.resolve({
            id: 'ses_a',
            bookId: 'book-1',
            title: 'A',
            createdAt: 1,
            updatedAt: 1,
            messages: [{ id: 'a0', role: 'user', content: 'on A', createdAt: 1 }],
          });
        }
        return staleLoad;
      }
      return Promise.resolve({
        id: 'ses_b',
        bookId: 'book-1',
        title: 'B',
        createdAt: 1,
        updatedAt: 1,
        messages: [{ id: 'b0', role: 'user', content: 'on B', createdAt: 1 }],
      });
    });

    streamEveTurn.mockImplementation(async function* () {
      yield { type: 'error' as const, message: 'model failed' };
    });

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId }),
      { initialProps: { sessionId: 'ses_a' } },
    );

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        expect.objectContaining({ id: 'a0', content: 'on A' }),
      ]);
    });

    await act(async () => {
      result.current.setComposer('boom');
    });

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = result.current.send();
    });

    // Switch to B while A's reconcile is still pending.
    await act(async () => {
      rerender({ sessionId: 'ses_b' });
    });
    await waitFor(() => {
      expect(result.current.messages).toEqual([
        expect.objectContaining({ id: 'b0', content: 'on B' }),
      ]);
    });

    await act(async () => {
      resolveStale!({
        id: 'ses_a',
        bookId: 'book-1',
        title: 'A',
        createdAt: 1,
        updatedAt: 1,
        messages: [{ id: 'stale', role: 'user', content: 'should not appear', createdAt: 9 }],
      });
      await sendPromise;
    });

    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'b0', content: 'on B' }),
    ]);
  });

  it('reconciles messages from disk after a stream error', async () => {
    getEveSession
      .mockResolvedValueOnce({
        id: 'ses_existing',
        bookId: 'book-1',
        title: 'Chat',
        createdAt: 1,
        updatedAt: 1,
        messages: [],
      })
      .mockResolvedValueOnce({
        id: 'ses_existing',
        bookId: 'book-1',
        title: 'Chat',
        createdAt: 1,
        updatedAt: 1,
        // Empty reply / model error: server dropped the in-flight user.
        messages: [],
      });

    streamEveTurn.mockImplementation(async function* () {
      yield { type: 'error' as const, message: 'Model returned an empty reply' };
    });

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: 'ses_existing' }),
    );
    await waitFor(() => {
      expect(result.current.sessionId).toBe('ses_existing');
    });

    await act(async () => {
      result.current.setComposer('Why?');
    });
    await act(async () => {
      await result.current.send();
    });

    await waitFor(() => {
      expect(getEveSession).toHaveBeenCalledTimes(2);
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toMatch(/empty reply/i);
  });

  it('clears a stream error when switching to New chat (sessionId → null)', async () => {
    getEveSession
      .mockResolvedValueOnce({
        id: 'ses_existing',
        bookId: 'book-1',
        title: 'Chat',
        createdAt: 1,
        updatedAt: 1,
        messages: [],
      })
      .mockResolvedValueOnce({
        id: 'ses_existing',
        bookId: 'book-1',
        title: 'Chat',
        createdAt: 1,
        updatedAt: 1,
        messages: [],
      });

    streamEveTurn.mockImplementation(async function* () {
      yield { type: 'error' as const, message: 'Model returned an empty reply' };
    });

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string | null }) =>
        useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId }),
      { initialProps: { sessionId: 'ses_existing' as string | null } },
    );
    await waitFor(() => {
      expect(result.current.sessionId).toBe('ses_existing');
    });

    await act(async () => {
      result.current.setComposer('Why?');
    });
    await act(async () => {
      await result.current.send();
    });
    await waitFor(() => {
      expect(result.current.error?.message).toMatch(/empty reply/i);
    });

    rerender({ sessionId: null });
    await waitFor(() => {
      expect(result.current.sessionId).toBeNull();
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
  });

  it('reconciles messages from disk when done is aborted', async () => {
    getEveSession
      .mockResolvedValueOnce({
        id: 'ses_existing',
        bookId: 'book-1',
        title: 'Chat',
        createdAt: 1,
        updatedAt: 1,
        messages: [{ id: 'kept', role: 'assistant', content: 'hello', createdAt: 1 }],
      })
      .mockResolvedValueOnce({
        id: 'ses_existing',
        bookId: 'book-1',
        title: 'Chat',
        createdAt: 1,
        updatedAt: 1,
        messages: [{ id: 'kept', role: 'assistant', content: 'hello', createdAt: 1 }],
      });

    streamEveTurn.mockImplementation(async function* () {
      yield assistantUi('a1', [textPart('partial')]);
      yield { type: 'abort' as const };
    });

    const { result } = renderHook(() =>
      useEveAgent({ bookId: 'book-1', bookTitle: 'Middlemarch', sessionId: 'ses_existing' }),
    );
    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    await act(async () => {
      result.current.setComposer('interrupted');
    });
    await act(async () => {
      await result.current.send();
    });

    await waitFor(() => {
      expect(getEveSession).toHaveBeenCalledTimes(2);
    });
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'kept', content: 'hello' }),
    ]);
    expect(result.current.status).toBe('ready');
  });
});
