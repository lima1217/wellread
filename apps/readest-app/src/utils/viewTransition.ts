/**
 * Whether the engine implements the View Transitions API at all
 * (`document.startViewTransition`). This is the baseline a simple route
 * crossfade needs, and it lands broadly: Chrome 111+, Edge, Safari 18+, and
 * recent Android WebView.
 */
export const detectViewTransitionsAPI = (): boolean =>
  typeof document !== 'undefined' && 'startViewTransition' in document;

/**
 * Whether the engine also supports nested view-transition groups
 * (`view-transition-group: nearest`, Chrome/WebView 140+) - a far narrower
 * target than the base API. This is what the paginator's layered turns
 * require: iOS 18 WebKit ships `startViewTransition` but crashes the
 * WebContent process on layered snapshots, so the group query marks the
 * mature engines where the layered turns are known to work.
 */
export const detectViewTransitionGroup = (): boolean =>
  detectViewTransitionsAPI() &&
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('view-transition-group', 'nearest');

/** Safari/WebKit throws when startViewTransition is called while one is active. */
export const isViewTransitionAbortError = (error: unknown): boolean =>
  typeof DOMException !== 'undefined' &&
  error instanceof DOMException &&
  error.name === 'AbortError' &&
  /view transition/i.test(error.message);

let viewTransitionAbortGuardInstalled = false;

/**
 * WebKit aborts the *previous* transition's `finished` promise when a new
 * `startViewTransition` begins. next-view-transitions only awaits
 * `transition.ready`, so that abort lands as an unhandled rejection that
 * Next's dev overlay surfaces ("Old view transition aborted by new view
 * transition"). Attach a handler to `finished` at creation so the AbortError
 * is contained, while genuine (non-abort) failures stay loud and other
 * consumers of `transition.finished` still observe the rejection.
 */
export const installViewTransitionAbortGuard = (): void => {
  if (
    viewTransitionAbortGuardInstalled ||
    typeof document === 'undefined' ||
    typeof document.startViewTransition !== 'function'
  ) {
    return;
  }
  viewTransitionAbortGuardInstalled = true;
  const native = document.startViewTransition.bind(document);
  document.startViewTransition = ((callback?: Parameters<typeof native>[0]) => {
    const transition = native(callback);
    void transition.finished.catch((error: unknown) => {
      if (!isViewTransitionAbortError(error)) {
        throw error;
      }
    });
    return transition;
  }) as typeof document.startViewTransition;
};
