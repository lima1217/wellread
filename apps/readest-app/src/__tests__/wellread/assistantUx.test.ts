import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionToolTrace } from '@wellread/eve-message';
import { classifyAssistantError, liveActivity } from '@/services/wellread/assistant/sessionUi';
import { useReadingAssistantStore } from '@/services/wellread/assistant/readingAssistantStore';
import { flashCfi, jumpToCfi, returnFromJump } from '@/services/wellread/assistant/readerJump';

describe('classifyAssistantError', () => {
  it.each([
    ['turn failed: 401 Unauthorized', 'auth'],
    ['Incorrect API key provided', 'auth'],
    ['429 Too Many Requests: rate limit reached', 'rateLimit'],
    ['You exceeded your current quota', 'rateLimit'],
    ["This model's maximum context length is 128000 tokens", 'context'],
    ['context_length_exceeded', 'context'],
    ['fetch failed', 'network'],
    ['connect ECONNREFUSED 127.0.0.1:443', 'network'],
    ['eve sidecar not connected', 'network'],
    ['Request timed out', 'network'],
    ['Model returned an empty reply', 'other'],
  ])('%s → %s', (message, kind) => {
    expect(classifyAssistantError(message)).toBe(kind);
  });
});

describe('liveActivity', () => {
  const pendingTool: SessionToolTrace = { id: 't1', name: 'search_book', args: { query: 'x' } };

  it('is idle when not busy', () => {
    expect(liveActivity(false, [{ role: 'user', content: 'hi' }], [])).toBeNull();
  });

  it('reports thinking before any assistant output', () => {
    expect(liveActivity(true, [{ role: 'user', content: 'hi' }], [])).toEqual({
      kind: 'thinking',
    });
  });

  it('reports the running tool, even after some text', () => {
    expect(
      liveActivity(
        true,
        [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'Let me check.' },
        ],
        [pendingTool],
      ),
    ).toEqual({ kind: 'tool', tool: pendingTool });
  });

  it('is idle while reply text or reasoning streams', () => {
    expect(liveActivity(true, [{ role: 'assistant', content: 'Streaming' }], [])).toBeNull();
    expect(
      liveActivity(true, [{ role: 'assistant', content: '', reasoning: 'hmm' }], []),
    ).toBeNull();
  });

  it('reports thinking after tools finish but before text arrives', () => {
    expect(
      liveActivity(
        true,
        [{ role: 'assistant', content: '', tools: [{ ...pendingTool, result: {} }] }],
        [],
      ),
    ).toEqual({ kind: 'thinking' });
  });
});

describe('composer drafts', () => {
  it('keeps one draft per book', () => {
    const store = useReadingAssistantStore.getState();
    store.setDraft('book-1', 'hello');
    store.setDraft('book-2', 'other');
    store.setDraft('book-1', '');
    expect(useReadingAssistantStore.getState().drafts).toEqual({ 'book-2': 'other' });
  });
});

type FakeView = {
  goTo: ReturnType<typeof vi.fn>;
  addAnnotation: ReturnType<typeof vi.fn>;
  lastLocation?: { cfi?: string };
};

const views = new Map<string, FakeView>();
vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      getView: (key: string) => views.get(key) ?? null,
      getViewSettings: () => ({ isEink: false }),
    }),
  },
}));

describe('reader jumps from the assistant', () => {
  let view: FakeView;
  beforeEach(() => {
    vi.useFakeTimers();
    view = {
      goTo: vi.fn().mockResolvedValue(undefined),
      addAnnotation: vi.fn(),
      lastLocation: { cfi: 'epubcfi(/6/2!/4/1:0)' },
    };
    views.set('book-key', view);
    useReadingAssistantStore.setState({ jumpOrigin: null });
  });
  afterEach(() => {
    vi.useRealTimers();
    views.clear();
  });

  it('flashes a temporary mark on the target and removes it later', () => {
    flashCfi('book-key', 'epubcfi(/6/4!/4/2,/1:0,/1:5)');
    const [note] = view.addAnnotation.mock.calls[0]!;
    expect(note).toMatchObject({ cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)', style: 'highlight' });
    expect(view.addAnnotation).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(view.addAnnotation).toHaveBeenLastCalledWith(note, true);
  });

  it('remembers where reading was before the first jump and returns there', async () => {
    await jumpToCfi('book-key', 'epubcfi(/6/4!/4/2)');
    view.lastLocation = { cfi: 'epubcfi(/6/4!/4/2)' };
    await jumpToCfi('book-key', 'epubcfi(/6/8!/4/2)');
    expect(useReadingAssistantStore.getState().jumpOrigin).toEqual({
      bookKey: 'book-key',
      cfi: 'epubcfi(/6/2!/4/1:0)',
    });

    await returnFromJump();
    expect(view.goTo).toHaveBeenLastCalledWith('epubcfi(/6/2!/4/1:0)');
    expect(useReadingAssistantStore.getState().jumpOrigin).toBeNull();
  });
});
