'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  Loader2Icon,
  SquareIcon,
  XIcon,
} from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { writeTextToClipboard } from '@/utils/clipboard';
import { saveSysSettings } from '@/helpers/settings';
import { getModelApiKey } from '@/services/wellread/modelApiKey';
import {
  getActiveProfile,
  mergeModelConfig,
  setActiveProfile,
  shouldHotReloadEve,
  toSidecarModelPayload,
} from '@/services/wellread/modelConfig';
import { reloadEveSidecar } from '@/services/wellread/eveSidecar';
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
import type { EveMessageQuote, EveToolTrace } from '@/services/wellread/assistant/eveClient';

interface AIAssistantProps {
  bookKey: string;
}

/** T3: always-visible summary + Details expands params. */
function ToolTrace({ tools }: { tools: EveToolTrace[] }) {
  const _ = useTranslation();
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const summary = summarizeToolTrace(tools);
  return (
    <div className='text-base-content/70 mt-2 flex flex-col gap-1 text-[11px]'>
      <div className='flex items-baseline gap-1.5'>
        <span>{summary ? _(summary) : _('Tool activity')}</span>
        <button type='button' className='underline' onClick={() => setOpen((v) => !v)}>
          {open ? _('Collapse') : _('Details')}
        </button>
      </div>
      {open ? (
        <div className='border-base-content/30 text-base-content space-y-0.5 border-s-2 ps-2 font-mono text-[10.5px]'>
          {tools.map((t) => (
            <div key={t.id}>
              <span className='font-semibold'>{t.name}</span>
              {t.args ? (
                <span className='text-base-content/70'> {JSON.stringify(t.args)}</span>
              ) : null}
              {t.result &&
              typeof t.result === 'object' &&
              t.result !== null &&
              'path' in t.result &&
              (t.result as { ok?: boolean }).ok ? (
                <span className='text-success'> → {(t.result as { path: string }).path}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** B1: stacked left-rule quotes inside the user bubble. */
function QuoteStack({ quotes }: { quotes: EveMessageQuote[] }) {
  if (!quotes.length) return null;
  return (
    <div className='border-base-300/60 mb-1.5 flex flex-col gap-1 border-b pb-1.5'>
      {quotes.map((q, i) => (
        <div
          key={`${q.text}-${i}`}
          className='border-base-content/30 text-base-content/70 line-clamp-2 border-s-2 ps-1.5 text-[11px] leading-snug'
        >
          {q.text}
          {q.chapterTitle?.trim() ? (
            <span className='text-base-content/70'> — 《{q.chapterTitle.trim()}》</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function CopyMessageButton({ content }: { content: string }) {
  const _ = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await writeTextToClipboard(content);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [content]);

  return (
    <button
      type='button'
      className='text-base-content mt-1.5 inline-flex items-center gap-1 text-[11px] underline'
      aria-label={copied ? _('Copied') : _('Copy')}
      onClick={() => {
        void handleCopy();
      }}
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      <span>{copied ? _('Copied') : _('Copy')}</span>
    </button>
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

const ReadingAssistantChat = ({ bookId, bookTitle }: { bookId: string; bookTitle: string }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
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

  const modelConfig = mergeModelConfig(settings.modelConfig);
  const activeProfile = getActiveProfile(modelConfig);
  const thinkingMode = settings.thinkingMode === 'think' ? 'think' : 'fast';

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

  const handleToggleThinkingMode = useCallback(() => {
    const next = thinkingMode === 'fast' ? 'think' : 'fast';
    void saveSysSettings(envConfig, 'thinkingMode', next);
  }, [envConfig, thinkingMode]);

  const handleSelectProfile = useCallback(
    async (profileId: string) => {
      if (busy) return;
      const previousActiveId = modelConfig.activeProfileId;
      const next = setActiveProfile(modelConfig, profileId);
      if (next === modelConfig) return;

      const updated = { ...settings, modelConfig: next };
      setSettings(updated);
      await saveSettings(envConfig, updated);

      if (
        shouldHotReloadEve({
          previousActiveId,
          nextActiveId: next.activeProfileId,
          editedProfileId: null,
        })
      ) {
        const active = getActiveProfile(next);
        if (active) {
          const apiKey = await getModelApiKey(active.id);
          const payload = toSidecarModelPayload(next);
          if (payload) {
            await reloadEveSidecar({ ...payload, apiKey });
          }
        } else {
          await reloadEveSidecar({ enabled: next.enabled });
        }
      }
      await useEveConnectionStore.getState().refresh();
    },
    [busy, envConfig, modelConfig, saveSettings, setSettings, settings],
  );

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
                : 'mr-2 rounded-lg px-3 py-2 text-sm'
            }
          >
            {msg.role === 'user' && msg.quotes?.length ? <QuoteStack quotes={msg.quotes} /> : null}
            {msg.role === 'assistant' ? (
              <div className='[&_blockquote]:border-base-content/30 [&_blockquote]:text-base-content/70 [&_pre]:bg-base-200/60 [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_blockquote]:border-s-2 [&_blockquote]:ps-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:p-2 [&_code]:text-[0.9em]'>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              </div>
            ) : (
              <div>{msg.content}</div>
            )}
            {msg.role === 'assistant' && msg.tools?.length ? <ToolTrace tools={msg.tools} /> : null}
            {msg.role === 'assistant' && msg.content.trim() ? (
              <CopyMessageButton content={msg.content} />
            ) : null}
          </div>
        ))}
        {agent.error ? <p className='text-error text-sm'>{agent.error.message}</p> : null}
      </div>
      <form
        className='border-base-300/50 shrink-0 border-t p-2.5'
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <div className='border-base-300/60 bg-base-200/40 eink-bordered focus-within:ring-base-content/15 flex flex-col rounded-lg border focus-within:ring-2'>
          <textarea
            className='min-h-[56px] w-full resize-none bg-transparent px-2.5 py-2 text-sm outline-none'
            value={agent.composer}
            onChange={(e) => agent.setComposer(e.target.value)}
            placeholder={_('Ask about this book…')}
            disabled={busy}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className='border-base-300/50 flex items-center gap-1.5 border-t px-2 py-1.5'>
            <div
              className={clsx('dropdown dropdown-top', busy && 'pointer-events-none opacity-50')}
            >
              <button
                type='button'
                tabIndex={0}
                className='border-base-300/60 bg-base-100 eink-bordered flex h-7 max-w-[110px] items-center gap-0.5 rounded-full border px-2.5 text-xs'
                disabled={busy}
                aria-label={_('Model')}
                onClick={(e) => e.currentTarget.focus()}
              >
                <span className='truncate'>{activeProfile?.name ?? _('Model')}</span>
                <ChevronDownIcon size={12} className='shrink-0 opacity-60' />
              </button>
              <ul
                tabIndex={0}
                className='dropdown-content menu bg-base-100 border-base-300 eink-bordered z-20 mb-1 max-h-48 min-w-[10rem] overflow-y-auto rounded-lg border p-1'
              >
                {modelConfig.profiles.map((profile) => {
                  const isActive = profile.id === modelConfig.activeProfileId;
                  return (
                    <li key={profile.id}>
                      <button
                        type='button'
                        className='flex items-center gap-2 text-sm'
                        onClick={() => {
                          void handleSelectProfile(profile.id);
                          (document.activeElement as HTMLElement | null)?.blur();
                        }}
                      >
                        <span className='flex w-4 shrink-0 justify-center'>
                          {isActive ? <CheckIcon size={14} /> : null}
                        </span>
                        <span className='truncate'>{profile.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <button
              type='button'
              className={clsx(
                'eink-bordered flex h-7 items-center rounded-full border px-2.5 text-xs',
                thinkingMode === 'think'
                  ? 'border-base-content bg-base-content text-base-100'
                  : 'border-base-300/60 text-base-content/60 bg-base-100',
              )}
              aria-pressed={thinkingMode === 'think'}
              aria-label={thinkingMode === 'think' ? _('Think') : _('Fast')}
              onClick={handleToggleThinkingMode}
            >
              {thinkingMode === 'think' ? _('Think') : _('Fast')}
            </button>
            {busy ? (
              <button
                type='button'
                className='btn btn-contrast btn-circle btn-sm ms-auto h-7 min-h-7 w-7 p-0'
                aria-label={_('Stop')}
                onClick={agent.stop}
              >
                <SquareIcon size={11} fill='currentColor' />
              </button>
            ) : (
              <button
                type='submit'
                className='btn btn-contrast btn-circle btn-sm ms-auto h-7 min-h-7 w-7 p-0'
                aria-label={_('Send')}
                disabled={!canSend}
              >
                <ArrowUpIcon size={14} strokeWidth={2.5} />
              </button>
            )}
          </div>
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
      bookId={bookId}
      bookTitle={bookTitle}
    />
  );
};

export default AIAssistant;
