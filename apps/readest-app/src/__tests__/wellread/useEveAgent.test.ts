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
});
