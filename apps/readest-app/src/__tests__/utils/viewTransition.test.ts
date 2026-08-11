import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  detectViewTransitionGroup,
  detectViewTransitionsAPI,
  installViewTransitionAbortGuard,
  isViewTransitionAbortError,
} from '@/utils/viewTransition';

// The DOM lib types startViewTransition as always present; go through a loose
// shape so the stub can also remove it.
type VTDocument = { startViewTransition?: () => void };

const stubEngine = ({
  startViewTransition,
  nestedGroups,
}: {
  startViewTransition: boolean;
  nestedGroups: boolean;
}) => {
  const doc = document as unknown as VTDocument;
  if (startViewTransition) doc.startViewTransition = () => {};
  else delete doc.startViewTransition;
  vi.stubGlobal('CSS', {
    supports: (property: string, value: string) =>
      nestedGroups && property === 'view-transition-group' && value === 'nearest',
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as unknown as VTDocument).startViewTransition;
});

describe('detectViewTransitionsAPI', () => {
  it('is true on any engine with document.startViewTransition, even without nested groups', () => {
    stubEngine({ startViewTransition: true, nestedGroups: false });
    expect(detectViewTransitionsAPI()).toBe(true);
  });

  it('is false without the View Transitions API', () => {
    stubEngine({ startViewTransition: false, nestedGroups: true });
    expect(detectViewTransitionsAPI()).toBe(false);
  });
});

describe('detectViewTransitionGroup', () => {
  it('requires nested view-transition groups on top of the API', () => {
    stubEngine({ startViewTransition: true, nestedGroups: false });
    expect(detectViewTransitionGroup()).toBe(false);
  });

  it('is true only when the API and nested groups are both present', () => {
    stubEngine({ startViewTransition: true, nestedGroups: true });
    expect(detectViewTransitionGroup()).toBe(true);
  });

  it('is false without the API even if the group query matches', () => {
    stubEngine({ startViewTransition: false, nestedGroups: true });
    expect(detectViewTransitionGroup()).toBe(false);
  });
});

describe('installViewTransitionAbortGuard', () => {
  type VTTransition = { finished: Promise<unknown>; ready: Promise<unknown> };
  type VTNative = (cb?: () => void) => VTTransition;

  let native: ReturnType<typeof vi.fn<VTNative>>;
  let abortError: DOMException;

  beforeEach(() => {
    abortError = new DOMException(
      'Old view transition aborted by new view transition.',
      'AbortError',
    );
    native = vi.fn<VTNative>(() => ({
      finished: Promise.reject(abortError),
      ready: Promise.resolve(),
    }));
    (document as unknown as { startViewTransition: VTNative }).startViewTransition = native;
  });

  it('contains the abort rejection while consumers still observe finished', async () => {
    installViewTransitionAbortGuard();
    const transition = (document.startViewTransition as unknown as VTNative)(() => {});
    await expect(transition.finished).rejects.toBe(abortError);
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('is a no-op after the first install', () => {
    installViewTransitionAbortGuard();
    installViewTransitionAbortGuard();
    expect(document.startViewTransition).toBe(native);
  });

  it('classifies view-transition AbortErrors and rejects other errors', () => {
    expect(
      isViewTransitionAbortError(
        new DOMException('Old view transition aborted by new view transition.', 'AbortError'),
      ),
    ).toBe(true);
    expect(
      isViewTransitionAbortError(new DOMException('The operation was aborted.', 'AbortError')),
    ).toBe(false);
    expect(isViewTransitionAbortError(new Error('boom'))).toBe(false);
    expect(isViewTransitionAbortError(null)).toBe(false);
  });
});
