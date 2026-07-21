import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const createEveSession = vi.fn();
const getEveSession = vi.fn();
const streamEveTurn = vi.fn();

vi.mock('@/services/wellread/assistant/eveClient', () => ({
  createEveSession: (...args: unknown[]) => createEveSession(...args),
  getEveSession: (...args: unknown[]) => getEveSession(...args),
  streamEveTurn: (...args: unknown[]) => streamEveTurn(...args),
}));

import { useEveAgent } from '@/services/wellread/assistant/useEveAgent';

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
      yield { type: 'done' as const };
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
      yield { type: 'message.user' as const, id: 'u1', content: 'What is vocation?' };
      yield { type: 'message.assistant.delta' as const, id: 'a1', delta: 'Hello' };
      await gate;
      yield {
        type: 'message.assistant' as const,
        id: 'a1',
        content: 'Hello',
      };
      yield { type: 'done' as const };
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
      yield { type: 'message.user' as const, id: 'u1', content: 'streaming…' };
      yield { type: 'message.assistant.delta' as const, id: 'a1', delta: 'partial' };
      await gate;
      if (signal.aborted) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      yield { type: 'done' as const };
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
    getEveSession.mockResolvedValue({
      id: 'ses_existing',
      bookId: 'book-1',
      title: 'Chat',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    });
    streamEveTurn.mockImplementation(async function* () {
      yield {
        type: 'message.user' as const,
        id: 'u1',
        content: '> quoted\n\nWhy?',
      };
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
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: 'Why?',
      quotes: [{ text: 'quoted', chapterTitle: null }],
    });
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
    getEveSession.mockResolvedValue({
      id: 'ses_existing',
      bookId: 'book-1',
      title: 'Chat',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    streamEveTurn.mockImplementation(async function* () {
      await gate;
      yield { type: 'message.user' as const, id: 'u1', content: 'What is vocation?' };
      yield { type: 'done' as const };
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
      yield { type: 'message.user' as const, id: 'u1', content: 'Why?' };
      yield {
        type: 'message.assistant.reasoning.delta' as const,
        id: 'a1',
        delta: 'step ',
      };
      yield {
        type: 'message.assistant.reasoning.delta' as const,
        id: 'a1',
        delta: 'two',
      };
      yield {
        type: 'message.assistant.delta' as const,
        id: 'a1',
        delta: 'Because vocation.',
      };
      yield {
        type: 'message.assistant' as const,
        id: 'a1',
        content: 'Because vocation.',
        reasoning: 'step two',
      };
      yield { type: 'done' as const };
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
    getEveSession.mockResolvedValue({
      id: 'ses_existing',
      bookId: 'book-1',
      title: 'Chat',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    streamEveTurn.mockImplementation(async function* () {
      yield { type: 'message.user' as const, id: 'u1', content: 'Why?' };
      yield {
        type: 'tool.start' as const,
        id: 't1',
        name: 'search_extract',
        args: { q: 'vocation' },
      };
      await gate;
      yield {
        type: 'message.assistant.delta' as const,
        id: 'a1',
        delta: 'Because…',
      };
      yield { type: 'done' as const };
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
    getEveSession.mockResolvedValue({
      id: 'ses_existing',
      bookId: 'book-1',
      title: 'Chat',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        { id: 'old1', role: 'user', content: 'earlier', createdAt: 1 },
        { id: 'old2', role: 'assistant', content: 'reply', createdAt: 2 },
      ],
    });
    streamEveTurn.mockImplementation(async function* () {
      yield { type: 'message.user' as const, id: 'u1', content: 'new question' };
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
      yield { type: 'done' as const };
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
