import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { fetchWithTimeout } from '@/utils/fetch';

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls fetch with the given URL and options', async () => {
    mockFetch.mockResolvedValueOnce(new Response('OK'));

    const promise = fetchWithTimeout('https://example.com', { method: 'GET' });
    vi.advanceTimersByTime(0);
    await promise;

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://example.com');
    expect(opts.method).toBe('GET');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes an AbortSignal to fetch', async () => {
    mockFetch.mockResolvedValueOnce(new Response('OK'));

    const promise = fetchWithTimeout('https://example.com');
    vi.advanceTimersByTime(0);
    await promise;

    const opts = mockFetch.mock.calls[0]![1];
    expect(opts.signal).toBeDefined();
  });

  it('uses default timeout of 10000ms', async () => {
    // Create a fetch that will hang until aborted
    mockFetch.mockImplementationOnce(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    const promise = fetchWithTimeout('https://slow.example.com');

    // Advance to just before default timeout
    vi.advanceTimersByTime(9999);
    // The promise should still be pending (not rejected yet)

    // Advance past the timeout
    vi.advanceTimersByTime(2);
    await expect(promise).rejects.toThrow();
  });

  it('uses custom timeout value', async () => {
    mockFetch.mockImplementationOnce(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    const promise = fetchWithTimeout('https://slow.example.com', {}, 500);

    vi.advanceTimersByTime(501);
    await expect(promise).rejects.toThrow();
  });

  it('clears timeout when fetch completes before timeout', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    mockFetch.mockResolvedValueOnce(new Response('OK'));

    const promise = fetchWithTimeout('https://fast.example.com');
    vi.advanceTimersByTime(0);
    await promise;

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('merges provided options with signal', async () => {
    mockFetch.mockResolvedValueOnce(new Response('OK'));

    const promise = fetchWithTimeout('https://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"key": "value"}',
    });
    vi.advanceTimersByTime(0);
    await promise;

    const opts = mockFetch.mock.calls[0]![1];
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(opts.body).toBe('{"key": "value"}');
    expect(opts.signal).toBeDefined();
  });
});
