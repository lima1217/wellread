import { useMemo } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useRouter } from 'next/navigation';
import { useTransitionRouter } from 'next-view-transitions';

/** Safari/WebKit throws when startViewTransition is called while one is active. */
export const isViewTransitionAbortError = (error: unknown): boolean =>
  typeof DOMException !== 'undefined' &&
  error instanceof DOMException &&
  error.name === 'AbortError' &&
  /view transition/i.test(error.message);

export const useAppRouter = () => {
  const { appService } = useEnv();
  const transitionRouter = useTransitionRouter();
  const plainRouter = useRouter();

  // A route transition is a plain full-page crossfade, so it only needs the
  // base View Transitions API - not the nested view-transition groups the
  // paginator turns require. Route through the transition router wherever the
  // API is usable (appService folds in the Linux WebKitGTK carve-out); engines
  // without it navigate plainly, sidestepping the DOM-update-budget TimeoutError
  // seen on unsupported webviews (Sentry READEST-9).
  //
  // When two navigations overlap (e.g. React Strict Mode remounting library
  // init, or a second push while a transition is in flight), WebKit aborts the
  // old transition with AbortError. Fall back to a plain navigation so the
  // route still changes and the error overlay stays quiet.
  return useMemo(() => {
    if (!appService?.supportsViewTransitionsAPI) {
      return plainRouter;
    }

    const withAbortFallback = <A extends unknown[]>(
      vtNav: (...args: A) => void,
      plainNav: (...args: A) => void,
    ) => {
      return (...args: A) => {
        try {
          vtNav(...args);
        } catch (error) {
          if (isViewTransitionAbortError(error)) {
            plainNav(...args);
            return;
          }
          throw error;
        }
      };
    };

    return {
      ...transitionRouter,
      push: withAbortFallback(transitionRouter.push.bind(transitionRouter), plainRouter.push),
      replace: withAbortFallback(
        transitionRouter.replace.bind(transitionRouter),
        plainRouter.replace,
      ),
    };
  }, [appService?.supportsViewTransitionsAPI, transitionRouter, plainRouter]);
};
