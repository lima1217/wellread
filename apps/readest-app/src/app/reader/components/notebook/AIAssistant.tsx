'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, Loader2Icon, XIcon } from 'lucide-react';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { getModelApiKey } from '@/services/wellread/modelApiKey';
import { getActiveProfile, mergeModelConfig } from '@/services/wellread/modelConfig';
import { useEveConnectionStore } from '@/services/wellread/eveConnectionStore';
import {
  isReadingAssistantAvailable,
  summarizeToolTrace,
} from '@/services/wellread/assistant/helpers';
import { useEveAgent } from '@/services/wellread/assistant/useEveAgent';
import {
  useReadingAssistantStore,
  type PendingQuote,
} from '@/services/wellread/assistant/readingAssistantStore';
import type {
  EveMessageQuote,
  EveSource,
  EveToolTrace,
} from '@/services/wellread/assistant/eveClient';

interface AIAssistantProps {
  bookKey: string;
}

function ToolTrace({ tools }: { tools: EveToolTrace[] }) {
  const _ = useTranslation();
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const summary = summarizeToolTrace(tools);
  return (
    <div className='border-base-300/60 eink-bordered mt-2 rounded-md border text-xs'>
      <button
        type='button'
        className='hover:bg-base-200/50 flex w-full items-center gap-1 px-2 py-1.5 text-left'
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        <span className='text-base-content/70'>{summary || _('Tool activity')}</span>
      </button>
      {open ? (
        <ul className='border-base-300/60 space-y-1 border-t px-2 py-1.5'>
          {tools.map((t) => (
            <li key={t.id} className='font-mono text-[11px]'>
              <span className='font-semibold'>{t.name}</span>
              {t.args ? (
                <span className='text-base-content/60'> {JSON.stringify(t.args)}</span>
              ) : null}
              {t.result &&
              typeof t.result === 'object' &&
              t.result !== null &&
              'path' in t.result &&
              (t.result as { ok?: boolean }).ok ? (
                <span className='text-success'> → {(t.result as { path: string }).path}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SourcesList({
  sources,
  onSourceClick,
}: {
  sources: EveSource[];
  onSourceClick: (source: EveSource) => void;
}) {
  const _ = useTranslation();
  if (!sources.length) return null;
  return (
    <div className='mt-2 space-y-1'>
      <div className='text-base-content/60 text-xs'>{_('Sources')}</div>
      <ul className='space-y-1'>
        {sources.map((source, i) => (
          <li key={`${source.cfi}-${i}`}>
            <button
              type='button'
              className='text-primary text-left text-xs hover:underline'
              onClick={() => onSourceClick(source)}
            >
              {source.title?.trim() || `${_('Source')} ${i + 1}`}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuoteStack({ quotes }: { quotes: EveMessageQuote[] }) {
  if (!quotes.length) return null;
  return (
    <div className='border-base-300/60 mb-1.5 space-y-1 border-b pb-1.5'>
      {quotes.map((q, i) => (
        <div
          key={`${q.text}-${i}`}
          className='border-base-content/30 text-base-content/60 line-clamp-2 border-s-2 ps-1.5 text-[11px]'
        >
          {q.text}
          {q.chapterTitle?.trim() ? (
            <span className='text-base-content/40'> — 《{q.chapterTitle.trim()}》</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PendingQuoteBar({
  quotes,
  onRemove,
  onClear,
}: {
  quotes: PendingQuote[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const _ = useTranslation();
  if (!quotes.length) return null;
  return (
    <div className='bg-base-200/70 border-base-300/50 eink-bordered flex shrink-0 flex-col gap-1.5 border-b px-2.5 py-2'>
      <div className='text-base-content/50 flex items-center justify-between text-[11px]'>
        <span>
          {_('Pending quotes')} ({quotes.length})
        </span>
        <button type='button' className='hover:text-base-content underline' onClick={onClear}>
          {_('Clear all')}
        </button>
      </div>
      {quotes.map((q) => (
        <div key={q.id} className='flex items-start gap-2 text-xs leading-snug'>
          <span className='text-base-content/40 shrink-0' aria-hidden>
            ❝
          </span>
          <span className='line-clamp-2 min-w-0 flex-1'>
            {q.text}
            {q.chapterTitle ? (
              <span className='text-base-content/40'> — 《{q.chapterTitle}》</span>
            ) : null}
          </span>
          <button
            type='button'
            className='text-base-content/40 hover:text-base-content shrink-0 p-0.5'
            aria-label={_('Remove quote')}
            onClick={() => onRemove(q.id)}
          >
            <XIcon size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

const ReadingAssistantChat = ({
  bookKey,
  bookId,
  bookTitle,
}: {
  bookKey: string;
  bookId: string;
  bookTitle: string;
}) => {
  const _ = useTranslation();
  const { getView } = useReaderStore();
  const activeSessionId = useReadingAssistantStore((s) => s.activeSessionId);
  const activeBookId = useReadingAssistantStore((s) => s.activeBookId);
  const pendingQuotes = useReadingAssistantStore((s) => s.pendingQuotes);
  const setActiveSession = useReadingAssistantStore((s) => s.setActiveSession);
  const removePendingQuote = useReadingAssistantStore((s) => s.removePendingQuote);
  const clearPendingQuotes = useReadingAssistantStore((s) => s.clearPendingQuotes);
  const restorePendingQuotes = useReadingAssistantStore((s) => s.restorePendingQuotes);

  const sessionId = activeBookId === bookId ? activeSessionId : null;

  const agent = useEveAgent({
    bookId,
    bookTitle,
    sessionId,
  });

  useEffect(() => {
    if (agent.sessionId && (agent.sessionId !== activeSessionId || activeBookId !== bookId)) {
      setActiveSession(agent.sessionId, bookId);
    }
  }, [agent.sessionId, activeSessionId, activeBookId, bookId, setActiveSession]);

  // Book switch while quotes remain from another book (panel may keep store alive).
  useEffect(() => {
    const state = useReadingAssistantStore.getState();
    if (state.pendingQuotes.length > 0 && state.activeBookId && state.activeBookId !== bookId) {
      state.clearPendingQuotes();
    }
  }, [bookId]);

  const onSourceClick = useCallback(
    (source: EveSource) => {
      getView(bookKey)?.goTo(source.cfi);
    },
    [bookKey, getView],
  );

  const busy = agent.status === 'submitted' || agent.status === 'streaming';
  const canSend = Boolean(agent.composer.trim()) && !busy;

  const handleSend = useCallback(() => {
    if (!agent.composer.trim() || busy) return;
    const quotes = useReadingAssistantStore.getState().pendingQuotes;
    clearPendingQuotes();
    void agent.send({
      quotes,
      onSendFailed: restorePendingQuotes,
    });
  }, [agent, busy, clearPendingQuotes, restorePendingQuotes]);

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <PendingQuoteBar
        quotes={pendingQuotes}
        onRemove={removePendingQuote}
        onClear={clearPendingQuotes}
      />
      <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3'>
        {agent.messages.length === 0 ? (
          <p className='text-base-content/60 text-sm'>
            {_(
              'Ask anything about this book. The assistant can search the extract tree when needed.',
            )}
          </p>
        ) : null}
        {agent.messages.map((msg) => (
          <div
            key={msg.id}
            className={
              msg.role === 'user'
                ? 'bg-base-200/60 ml-6 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap'
                : 'mr-2 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap'
            }
          >
            {msg.role === 'user' && msg.quotes?.length ? <QuoteStack quotes={msg.quotes} /> : null}
            <div>{msg.content}</div>
            {msg.role === 'assistant' && msg.tools?.length ? <ToolTrace tools={msg.tools} /> : null}
            {msg.role === 'assistant' && msg.sources?.length ? (
              <SourcesList sources={msg.sources} onSourceClick={onSourceClick} />
            ) : null}
          </div>
        ))}
        {agent.error ? <p className='text-error text-sm'>{agent.error.message}</p> : null}
      </div>
      <form
        className='border-base-300/50 flex shrink-0 gap-2 border-t p-2'
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <textarea
          className='textarea textarea-bordered eink-bordered min-h-[72px] flex-1 text-sm'
          value={agent.composer}
          onChange={(e) => agent.setComposer(e.target.value)}
          placeholder={_('Ask about this book…')}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <div className='flex flex-col gap-1'>
          {busy ? (
            <button type='button' className='btn btn-ghost btn-sm' onClick={agent.stop}>
              {_('Stop')}
            </button>
          ) : (
            <button type='submit' className='btn btn-contrast btn-sm' disabled={!canSend}>
              {_('Send')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
};

const AIAssistant = ({ bookKey }: AIAssistantProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const bookData = getBookData(bookKey);
  const ready = useEveConnectionStore((s) => s.ready);
  const [hasKey, setHasKey] = useState(false);

  const modelConfig = settings?.modelConfig;
  const activeProfileId = modelConfig
    ? (getActiveProfile(mergeModelConfig(modelConfig))?.id ?? null)
    : null;

  useEffect(() => {
    let cancelled = false;
    if (!appService || !activeProfileId) {
      setHasKey(false);
      return;
    }
    void getModelApiKey(activeProfileId).then((key) => {
      if (!cancelled) setHasKey(Boolean(key?.trim()));
    });
    return () => {
      cancelled = true;
    };
  }, [appService, activeProfileId]);

  const available = isReadingAssistantAvailable({
    modelEnabled: modelConfig?.enabled ?? false,
    sidecarReady: ready,
    hasActiveProfile: Boolean(activeProfileId),
    hasApiKey: hasKey,
  });

  const bookId = bookData?.book?.hash || '';
  const bookTitle = bookData?.book?.title || '';
  const activeSessionId = useReadingAssistantStore((s) => s.activeSessionId);

  if (!available) {
    return (
      <div className='text-base-content/70 flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm'>
        {!ready ? <Loader2Icon className='animate-spin' size={20} /> : null}
        <p>
          {_(
            'Enable Reading Assistant in Settings, add an API key, and wait for the local sidecar to start.',
          )}
        </p>
      </div>
    );
  }

  if (!bookId) {
    return (
      <div className='text-base-content/70 flex h-full items-center justify-center p-4 text-sm'>
        {_('Open a book to chat with the Reading Assistant.')}
      </div>
    );
  }

  return (
    <ReadingAssistantChat
      key={`${bookId}-${activeSessionId ?? 'new'}`}
      bookKey={bookKey}
      bookId={bookId}
      bookTitle={bookTitle}
    />
  );
};

export default AIAssistant;
