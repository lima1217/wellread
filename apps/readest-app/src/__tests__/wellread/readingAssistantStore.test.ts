import { beforeEach, describe, expect, it } from 'vitest';
import { useReadingAssistantStore } from '@/services/wellread/assistant/readingAssistantStore';

beforeEach(() => {
  useReadingAssistantStore.setState({
    activeSessionId: null,
    activeBookId: null,
    pendingQuotes: [],
  });
});

describe('readingAssistantStore pending quotes', () => {
  it('appends Pending Quote segments without replacing existing ones', () => {
    const store = useReadingAssistantStore.getState();
    store.appendPendingQuote({ text: ' first ', chapterTitle: 'Ch 1' });
    store.appendPendingQuote({ text: 'second' });

    const quotes = useReadingAssistantStore.getState().pendingQuotes;
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({ text: 'first', chapterTitle: 'Ch 1' });
    expect(quotes[1]).toMatchObject({ text: 'second', chapterTitle: null });
    expect(quotes[0]!.id).toBeTruthy();
    expect(quotes[1]!.id).not.toBe(quotes[0]!.id);
  });

  it('removes a single Pending Quote by id', () => {
    const store = useReadingAssistantStore.getState();
    store.appendPendingQuote({ text: 'a' });
    store.appendPendingQuote({ text: 'b' });
    const [first, second] = useReadingAssistantStore.getState().pendingQuotes;
    store.removePendingQuote(first!.id);

    expect(useReadingAssistantStore.getState().pendingQuotes).toEqual([second]);
  });

  it('clears all Pending Quotes', () => {
    const store = useReadingAssistantStore.getState();
    store.appendPendingQuote({ text: 'a' });
    store.appendPendingQuote({ text: 'b' });
    store.clearPendingQuotes();

    expect(useReadingAssistantStore.getState().pendingQuotes).toEqual([]);
  });

  it('clears Pending Quotes when the active book changes', () => {
    const store = useReadingAssistantStore.getState();
    store.setActiveSession('ses_1', 'book-a');
    store.appendPendingQuote({ text: 'keep until book change' });
    store.setActiveSession('ses_2', 'book-b');

    expect(useReadingAssistantStore.getState().pendingQuotes).toEqual([]);
    expect(useReadingAssistantStore.getState().activeBookId).toBe('book-b');
  });

  it('keeps Pending Quotes when the session changes on the same book', () => {
    const store = useReadingAssistantStore.getState();
    store.setActiveSession('ses_1', 'book-a');
    store.appendPendingQuote({ text: 'still pending' });
    store.setActiveSession('ses_2', 'book-a');

    expect(useReadingAssistantStore.getState().pendingQuotes).toHaveLength(1);
    expect(useReadingAssistantStore.getState().pendingQuotes[0]!.text).toBe('still pending');
  });

  it('restores Pending Quotes after a failed send', () => {
    const store = useReadingAssistantStore.getState();
    store.appendPendingQuote({ text: 'a' });
    const snapshot = useReadingAssistantStore.getState().pendingQuotes;
    store.clearPendingQuotes();
    store.restorePendingQuotes(snapshot);

    expect(useReadingAssistantStore.getState().pendingQuotes).toEqual(snapshot);
  });
});
