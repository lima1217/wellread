import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { getBookProgress, useReaderProgressStore } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { BookNote } from '@/types/book';
import { exportBookAnnotations } from '@/services/wellread/assistant/annotationsExport';
import { clearReaderLive, putReaderLive } from '@/services/wellread/assistant/eveClient';
import { buildReaderLivePayload } from '@/services/wellread/assistant/readerLive';
import { useReadingAssistantStore } from '@/services/wellread/assistant/readingAssistantStore';
import { useEveConnectionStore } from '@/services/wellread/eveConnectionStore';
import { createAppServiceExtractFs } from '@/services/wellread/extract/ensureExtractForOpenedBook';
import { buildSpineChapterTitleLookup } from '@/services/wellread/extract/spineChapterTitles';

const PUSH_DEBOUNCE_MS = 300;
const EXPORT_DEBOUNCE_MS = 1000;

/**
 * Keep the sidecar's live reader state current while this book is open, so
 * external agents (MCP) see the book, position, selection and Pending Quotes,
 * and keep the annotations export fresh for them between in-app turns.
 * Subscribes imperatively: page turns never re-render the caller.
 */
export function useReaderLivePublisher(
  bookKey: string,
  selection: { text: string; cfi?: string } | null,
) {
  const { appService } = useEnv();
  const selectionRef = useRef(selection);
  const pushRef = useRef<() => void>(() => {});

  useEffect(() => {
    let pushTimer: ReturnType<typeof setTimeout> | undefined;
    let exportTimer: ReturnType<typeof setTimeout> | undefined;
    let pushedBookId: string | null = null;
    let exported: { booknotes: BookNote[] | undefined; share: boolean } | null = null;

    const settings = () => useSettingsStore.getState().settings;
    const book = () => useBookDataStore.getState().getBookData(bookKey)?.book;

    const push = () => {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        const bookId = book()?.hash;
        if (!bookId || !useEveConnectionStore.getState().ready) return;
        const { pendingQuotes, activeBookId } = useReadingAssistantStore.getState();
        pushedBookId = bookId;
        void putReaderLive(
          buildReaderLivePayload({
            bookId,
            bookTitle: book()?.title,
            progress: getBookProgress(bookKey),
            selection: selectionRef.current,
            pendingQuotes,
            pendingQuotesBookId: activeBookId,
            spoilerGuard: settings().assistantSpoilerGuard === true,
            shareAnnotations: settings().assistantShareAnnotations !== false,
          }),
        ).catch(() => {});
      }, PUSH_DEBOUNCE_MS);
    };
    pushRef.current = push;

    const exportAnnotations = () => {
      const share = settings().assistantShareAnnotations !== false;
      const { getConfig, getBookData } = useBookDataStore.getState();
      const booknotes = getConfig(bookKey)?.booknotes;
      if (exported && exported.booknotes === booknotes && exported.share === share) return;
      exported = { booknotes, share };
      clearTimeout(exportTimer);
      exportTimer = setTimeout(() => {
        const data = getBookData(bookKey);
        const bookId = data?.book?.hash;
        if (!appService || !bookId || !useEveConnectionStore.getState().ready) return;
        void exportBookAnnotations({
          fs: createAppServiceExtractFs(appService),
          bookId,
          bookTitle: data?.book?.title ?? '',
          booknotes: share ? (booknotes ?? []) : [],
          getChapterTitle: data?.bookDoc ? buildSpineChapterTitleLookup(data.bookDoc) : undefined,
        }).catch(() => {});
      }, EXPORT_DEBOUNCE_MS);
    };

    const onSidecarChange = () => {
      // A restarted sidecar starts empty: push again and re-export.
      exported = null;
      push();
      exportAnnotations();
    };
    const unsubscribe = [
      useReaderProgressStore.subscribe(push),
      useReadingAssistantStore.subscribe((s, prev) =>
        s.pendingQuotes !== prev.pendingQuotes ? push() : undefined,
      ),
      useSettingsStore.subscribe(() => {
        push();
        exportAnnotations();
      }),
      useEveConnectionStore.subscribe((s, prev) =>
        s.info !== prev.info ? onSidecarChange() : undefined,
      ),
      useBookDataStore.subscribe(exportAnnotations),
    ];
    // The focused window's book is the one external agents should see.
    window.addEventListener('focus', push);
    onSidecarChange();

    return () => {
      clearTimeout(pushTimer);
      clearTimeout(exportTimer);
      for (const off of unsubscribe) off();
      window.removeEventListener('focus', push);
      pushRef.current = () => {};
      if (pushedBookId && useEveConnectionStore.getState().ready) {
        void clearReaderLive(pushedBookId).catch(() => {});
      }
    };
  }, [appService, bookKey]);

  useEffect(() => {
    selectionRef.current = selection;
    pushRef.current();
  }, [selection]);
}
