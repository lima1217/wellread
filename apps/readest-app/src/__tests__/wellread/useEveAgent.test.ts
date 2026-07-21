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
});
