import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isViewTransitionAbortError, useAppRouter } from '@/hooks/useAppRouter';

const transitionRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
const plainRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock('next-view-transitions', () => ({
  useTransitionRouter: () => transitionRouter,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => plainRouter,
}));

const useEnvMock = vi.fn();
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => useEnvMock(),
}));

afterEach(() => {
  useEnvMock.mockReset();
  transitionRouter.push.mockReset();
  transitionRouter.replace.mockReset();
  plainRouter.push.mockReset();
  plainRouter.replace.mockReset();
});

describe('isViewTransitionAbortError', () => {
  it('matches WebKit overlapping View Transition AbortErrors', () => {
    expect(
      isViewTransitionAbortError(
        new DOMException('Old view transition aborted by new view transition.', 'AbortError'),
      ),
    ).toBe(true);
  });

  it('ignores unrelated abort and non-abort errors', () => {
    expect(
      isViewTransitionAbortError(new DOMException('The operation was aborted.', 'AbortError')),
    ).toBe(false);
    expect(isViewTransitionAbortError(new Error('boom'))).toBe(false);
    expect(isViewTransitionAbortError(null)).toBe(false);
  });
});

describe('useAppRouter', () => {
  it('routes through the View Transition router when the engine has the API', () => {
    useEnvMock.mockReturnValue({ appService: { supportsViewTransitionsAPI: true } });
    const { result } = renderHook(() => useAppRouter());
    expect(result.current.push).toBeTypeOf('function');
    result.current.push('/reader?ids=book1');
    expect(transitionRouter.push).toHaveBeenCalledWith('/reader?ids=book1');
    expect(plainRouter.push).not.toHaveBeenCalled();
  });

  it('falls back to the plain router when the engine lacks the View Transitions API', () => {
    useEnvMock.mockReturnValue({ appService: { supportsViewTransitionsAPI: false } });
    const { result } = renderHook(() => useAppRouter());
    expect(result.current).toBe(plainRouter);
  });

  it('falls back to the plain router before the app service is ready', () => {
    useEnvMock.mockReturnValue({ appService: null });
    const { result } = renderHook(() => useAppRouter());
    expect(result.current).toBe(plainRouter);
  });

  it('falls back to plain push when a View Transition is aborted by a newer one', () => {
    useEnvMock.mockReturnValue({ appService: { supportsViewTransitionsAPI: true } });
    transitionRouter.push.mockImplementation(() => {
      throw new DOMException('Old view transition aborted by new view transition.', 'AbortError');
    });

    const { result } = renderHook(() => useAppRouter());
    expect(() => result.current.push('/reader?ids=book1')).not.toThrow();
    expect(plainRouter.push).toHaveBeenCalledWith('/reader?ids=book1');
  });

  it('falls back to plain replace when a View Transition is aborted by a newer one', () => {
    useEnvMock.mockReturnValue({ appService: { supportsViewTransitionsAPI: true } });
    transitionRouter.replace.mockImplementation(() => {
      throw new DOMException('Old view transition aborted by new view transition.', 'AbortError');
    });

    const { result } = renderHook(() => useAppRouter());
    expect(() => result.current.replace('/library')).not.toThrow();
    expect(plainRouter.replace).toHaveBeenCalledWith('/library');
  });

  it('re-throws non-abort errors from the View Transition router', () => {
    useEnvMock.mockReturnValue({ appService: { supportsViewTransitionsAPI: true } });
    transitionRouter.push.mockImplementation(() => {
      throw new Error('boom');
    });

    const { result } = renderHook(() => useAppRouter());
    expect(() => result.current.push('/reader')).toThrow('boom');
    expect(plainRouter.push).not.toHaveBeenCalled();
  });
});
