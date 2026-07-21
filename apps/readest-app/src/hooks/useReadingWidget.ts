import { useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { refreshReadingWidget } from '@/services/widget/readingWidget';
import { debounce } from '@/utils/debounce';
import { useTranslation } from './useTranslation';

/**
 * Publish the home-screen reading-widget snapshot. The widget is only visible
 * while the app is backgrounded, so we publish (1) once the library is loaded
 * and (2) whenever the app goes to the background. Mounted on both the library
 * and reader pages.
 */
export function useReadingWidget() {
  const _ = useTranslation();
  const { appService } = useEnv();
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);

  useEffect(() => {
    if (!appService?.isMobileApp) return;
    const labels = {
      // The widget intentionally shows no section header (minimal UI), so the
      // section title is left empty.
      sectionTitle: '',
      emptyTitle: _('Your books will appear here'),
    };

    const publish = debounce(() => {
      void refreshReadingWidget(appService, labels);
    }, 500);

    if (libraryLoaded) publish();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Flush now: the WebView may be suspended before a debounced timer
        // fires, and backgrounding is exactly when the widget needs the latest
        // reading progress.
        publish();
        publish.flush();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      publish.cancel();
    };
  }, [appService, libraryLoaded, _]);
}
