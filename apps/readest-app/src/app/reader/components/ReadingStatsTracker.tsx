'use client';

import { useEffect, useRef } from 'react';
import { useBookProgress } from '@/store/readerProgressStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { TrackerCore, type FlushedEvent } from '@/services/statistics/trackerCore';
import { DEFAULT_STATS_TRACKING_CONFIG } from '@/types/statistics';

const nowSec = () => Math.floor(Date.now() / 1000);

const runBestEffort = (work: Promise<unknown>): void => {
  void work.catch((err) => console.warn('[stats] background operation failed:', err));
};

export default function ReadingStatsTracker({ bookKey }: { bookKey: string }) {
  const { appService } = useEnv();
  const progress = useBookProgress(bookKey);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const coreRef = useRef(new TrackerCore(DEFAULT_STATS_TRACKING_CONFIG));
  const dbRef = useRef<StatisticsDb | null>(null);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bookData = getBookData(bookKey);
  const book = bookData?.book;
  const bookMd5 = book?.hash;
  const title = book?.title ?? '';
  const authors = book?.author ?? '';

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    StatisticsDb.open(appService).then((db) => {
      if (cancelled) return;
      dbRef.current = db;
    });
    return () => {
      cancelled = true;
    };
  }, [appService]);

  const persist = async (events: FlushedEvent[]): Promise<void> => {
    const db = dbRef.current;
    if (!db || !bookMd5 || events.length === 0) return;
    try {
      const idBook = await db.upsertBook({ bookMd5, title, authors });
      for (const e of events) await db.insertPageEvent(idBook, e);
      await db.recomputeBookTotals(idBook);
    } catch (err) {
      console.warn('[stats] failed to persist reading events:', err);
    }
  };

  const armIdle = () => {
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(
      () => void persist(coreRef.current.onIdle(nowSec())),
      DEFAULT_STATS_TRACKING_CONFIG.idleTimeoutSeconds * 1000,
    );
  };

  useEffect(() => {
    const info = progress?.pageinfo;
    if (!info) return;
    const page = (info.current ?? 0) + 1;
    const total = info.total || 1;
    void persist(coreRef.current.onPage(page, total, nowSec()));
    armIdle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.pageinfo]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        if (idleRef.current) clearTimeout(idleRef.current);
        void persist(coreRef.current.onHide(nowSec()));
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookMd5]);

  useEffect(() => {
    return () => {
      if (idleRef.current) clearTimeout(idleRef.current);
      runBestEffort(persist(coreRef.current.onClose(nowSec())));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookMd5]);

  return null;
}
