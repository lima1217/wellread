/**
 * Reading Assistant → reader navigation: jump to a cited/quoted cfi, flash the
 * target so it is findable on the page, and remember where reading was.
 */

import { useReaderStore } from '@/store/readerStore';
import { eventDispatcher } from '@/utils/event';
import type { BookNote } from '@/types/book';
import { useReadingAssistantStore } from './readingAssistantStore';

const FLASH_MS = 2500;

/** Temporary mark on `cfi` (not saved to booknotes); removed after FLASH_MS. */
export function flashCfi(bookKey: string, cfi: string) {
  const { getView, getViewSettings } = useReaderStore.getState();
  const view = getView(bookKey);
  if (!view) return;
  const now = Date.now();
  const note: BookNote = {
    id: `assistant-flash-${now}`,
    type: 'annotation',
    cfi,
    // B&W e-ink draws highlights as background colour; an underline stays visible.
    style: getViewSettings(bookKey)?.isEink ? 'underline' : 'highlight',
    color: 'yellow',
    note: '',
    createdAt: now,
    updatedAt: now,
  };
  try {
    view.addAnnotation(note);
  } catch {
    return;
  }
  window.setTimeout(() => {
    try {
      view.addAnnotation(note, true);
    } catch {
      // Section may have been unloaded; nothing left to remove.
    }
  }, FLASH_MS);
}

export async function jumpToCfi(bookKey: string, cfi: string) {
  const view = useReaderStore.getState().getView(bookKey);
  const { jumpOrigin, setJumpOrigin } = useReadingAssistantStore.getState();
  const here = view?.lastLocation?.cfi;
  if (here && jumpOrigin?.bookKey !== bookKey) setJumpOrigin({ bookKey, cfi: here });
  eventDispatcher.dispatch('navigate', { bookKey, cfi });
  if (!view) return;
  await view.goTo(cfi);
  flashCfi(bookKey, cfi);
}

/** Go back to the position saved before the first jump. */
export async function returnFromJump() {
  const { jumpOrigin, setJumpOrigin } = useReadingAssistantStore.getState();
  if (!jumpOrigin) return;
  setJumpOrigin(null);
  await useReaderStore.getState().getView(jumpOrigin.bookKey)?.goTo(jumpOrigin.cfi);
}
