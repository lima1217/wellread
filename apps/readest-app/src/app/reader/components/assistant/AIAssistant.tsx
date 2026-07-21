'use client';

import { useCallback, useEffect, useRef, useState, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { ArrowUpIcon, CheckIcon, ChevronUpIcon, CopyIcon, Loader2Icon, XIcon } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useEnv } from '@/context/EnvContext';
import { writeTextToClipboard } from '@/utils/clipboard';
import { saveSysSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';
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
  formatEveSourceLabel,
  formatWorkDuration,
  isExternalHttpHref,
  isReadingAssistantAvailable,
  resolveEveSource,
  shouldPushAgentSessionToStore,
  shouldShowPendingReply,
  summarizeToolTrace,
} from '@/services/wellread/assistant/helpers';
import { useEveAgent } from '@/services/wellread/assistant/useEveAgent';
import {
  useReadingAssistantStore,
  type PendingQuote,
} from '@/services/wellread/assistant/readingAssistantStore';
import type {
  EveMessage,
  EveMessageQuote,
  EveSource,
  EveToolTrace,
} from '@/services/wellread/assistant/eveClient';
import { openExternalUrl } from '@/utils/open';

interface AIAssistantProps {
  bookKey: string;
}

const focusRing =
  'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2';

/** Composer toolbar selects: flat ghost, not filled pills. */
const composerSelectTrigger = clsx(
  'text-base-content/55 hover:text-base-content hover:bg-base-200/70',
  'flex h-7 items-center gap-1 rounded-md px-2 text-[0.85em] leading-none whitespace-nowrap',
  'transition-colors duration-150',
);
const composerSelectMenu = clsx(
  'dropdown-content no-triangle border-base-200 bg-base-100 eink-bordered',
  'z-20 mb-1.5 overflow-y-auto overscroll-contain !rounded-lg border !p-1 font-sans',
);
const composerSelectItem = clsx(
  'hover:bg-base-200/80 flex w-full items-center gap-2 rounded-md px-2 py-1.5',
  'text-start text-[0.85em] leading-snug',
);
/** Shared circular action: solid when Send/Stop is live, muted when idle. */
const composerPrimaryBtn =
  'ms-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150';
const composerPrimaryBtnLive = 'bg-base-content text-base-100 hover:opacity-90';
const composerPrimaryBtnIdle = 'bg-base-200/70 text-base-content/30';

/** Book excerpt in assistant prose — editorial pull-quote, not a chat bubble. */
function MarkdownBlockquote({ children }: { children?: ReactNode }) {
  return (
    <blockquote className='border-base-content/20 text-base-content/65 my-[0.9em] border-s-2 ps-3.5 text-[0.92em] leading-[1.7] not-italic'>
      <div
        className='text-base-content/30 mb-1 select-none font-sans text-[0.8em] leading-none tracking-wide'
        aria-hidden='true'
      >
        ❝
      </div>
      <div className='[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0'>{children}</div>
    </blockquote>
  );
}

/** Models often wrap citations with `---` → `<hr>`; keep the break, drop the white line. */
function MarkdownRule() {
  return <div className='my-[0.9em]' aria-hidden='true' />;
}

function plainTextFromChildren(children: ReactNode): string {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(plainTextFromChildren).join('');
  if (isValidElement(children)) {
    const el = children as ReactElement<{ children?: ReactNode }>;
    return plainTextFromChildren(el.props.children);
  }
  return '';
}

function jumpToCfi(bookKey: string, cfi: string) {
  eventDispatcher.dispatch('navigate', { bookKey, cfi });
  useReaderStore.getState().getView(bookKey)?.goTo(cfi);
}

function createAssistantMarkdownComponents(opts: {
  bookKey: string;
  sources?: EveSource[];
}): Components {
  return {
    blockquote: ({ children }) => <MarkdownBlockquote>{children}</MarkdownBlockquote>,
    hr: () => <MarkdownRule />,
    a: ({ href, children }) => {
      const label = plainTextFromChildren(children);
      const source = resolveEveSource(opts.sources, { href, label });
      if (source?.cfi) {
        return (
          <button
            type='button'
            className={clsx(
              'text-base-content underline decoration-from-font underline-offset-2',
              'hover:text-base-content/80',
              focusRing,
            )}
            onClick={(e) => {
              e.preventDefault();
              jumpToCfi(opts.bookKey, source.cfi);
            }}
          >
            {children}
          </button>
        );
      }
      // Relative/file/workspace hrefs must not become target=_blank — that opens a
      // non-Tauri browser window and crashes settings sync on getCurrentWindow().
      if (!isExternalHttpHref(href)) {
        return <span>{children}</span>;
      }
      return (
        <button
          type='button'
          className={clsx(
            'text-base-content underline decoration-from-font underline-offset-2',
            'hover:text-base-content/80',
            focusRing,
          )}
          onClick={(e) => {
            e.preventDefault();
            openExternalUrl(href!);
          }}
        >
          {children}
        </button>
      );
    },
  };
}

/** Structured jump targets from tool-collected chunk frontmatter. */
function MessageSources({ bookKey, sources }: { bookKey: string; sources: EveSource[] }) {
  const _ = useTranslation();
  if (!sources.length) return null;
  return (
    <div className='text-base-content/60 mt-2 flex flex-col gap-1 font-sans text-[0.85em] leading-snug'>
      <span className='select-none'>{_('Sources')}</span>
      <ul className='flex flex-col gap-0.5'>
        {sources.map((source, index) => {
          const label = formatEveSourceLabel(source, index);
          return (
            <li key={`${source.cfi}-${index}`}>
              <button
                type='button'
                className={clsx(
                  'text-start underline decoration-from-font underline-offset-2',
                  'hover:text-base-content',
                  focusRing,
                )}
                onClick={() => jumpToCfi(bookKey, source.cfi)}
              >
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Chat body uses app UI type, not the reader's book face. Keep 16px + 1.75 for CJK air. */
const messageTypeClass = 'font-sans text-base leading-[1.75]';
const markdownBodyClass = clsx(
  'break-words [&_a]:break-all',
  '[&_code]:font-mono [&_code]:text-[0.9em]',
  '[&_h1]:mb-[0.55em] [&_h1]:text-balance [&_h1]:text-[1.15em] [&_h1]:leading-[1.3] [&_h1]:font-semibold',
  '[&_h2]:mb-[0.5em] [&_h2]:text-balance [&_h2]:text-[1.08em] [&_h2]:leading-[1.35] [&_h2]:font-semibold',
  '[&_h3]:mb-[0.45em] [&_h3]:text-balance [&_h3]:font-semibold [&_h3]:leading-[1.4]',
  '[&_li]:my-[0.5em]',
  '[&_ol]:my-[0.9em] [&_ul]:my-[0.9em]',
  '[&_p]:my-[0.9em] [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_pre]:bg-base-100/80 [&_pre]:my-[0.9em] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-3.5',
  '[&_pre_code]:font-mono',
);

/** T3: always-visible summary + Details expands params. */
function ToolTrace({ tools }: { tools: EveToolTrace[] }) {
  const _ = useTranslation();
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const summary = summarizeToolTrace(tools);
  return (
    <div className='text-base-content/60 mt-2 flex flex-col gap-1 font-sans text-[0.85em] leading-snug select-none'>
      <div className='flex items-baseline gap-1.5'>
        <span>{summary ? _(summary) : _('Tool activity')}</span>
        <button
          type='button'
          className={clsx('underline decoration-from-font underline-offset-2', focusRing)}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? _('Collapse') : _('Details')}
        </button>
      </div>
      {open ? (
        <div className='border-base-content/25 text-base-content/80 space-y-0.5 break-words border-s-2 ps-2 font-mono'>
          {tools.map((t) => (
            <div key={t.id}>
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
    <div className='mb-1.5 flex flex-col gap-1 pb-0.5'>
      {quotes.map((q, i) => {
        const chapter = q.chapterTitle?.trim();
        const full = chapter ? `${q.text} — 《${chapter}》` : q.text;
        return (
          <div
            key={`${q.text}-${i}`}
            title={full}
            className='border-base-content/25 text-base-content/70 line-clamp-2 border-s-2 ps-1.5 text-[0.85em] leading-snug'
          >
            {q.text}
            {chapter ? <span className='text-base-content/50'> — 《{chapter}》</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Quiet three-dot wait cue while the assistant has no visible reply yet. */
function PendingReplyDots({ lookingUp }: { lookingUp: boolean }) {
  const _ = useTranslation();
  const label = lookingUp ? _('Looking up…') : _('Thinking…');
  return (
    <div
      className={clsx(
        messageTypeClass,
        'text-base-content/55 me-1 flex items-center gap-2 px-0.5 py-0.5',
      )}
      role='status'
      aria-label={label}
    >
      {lookingUp ? <span className='font-sans text-[0.85em] leading-none'>{label}</span> : null}
      <span className='assistant-pending-dots inline-flex items-center gap-1' aria-hidden='true'>
        <span className='bg-base-content size-1 rounded-full' />
        <span className='bg-base-content size-1 rounded-full' />
        <span className='bg-base-content size-1 rounded-full' />
      </span>
    </div>
  );
}

function ReasoningBlock({ reasoning }: { reasoning: string }) {
  const _ = useTranslation();
  const [open, setOpen] = useState(true);
  if (!reasoning.trim()) return null;
  return (
    <details
      className='group border-base-content/10 mb-3.5 border-s ps-3'
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className={clsx(
          'text-base-content/50 hover:text-base-content/75 font-sans text-[0.8em] leading-none',
          'cursor-pointer list-none select-none',
          '[&::-webkit-details-marker]:hidden',
          focusRing,
        )}
      >
        {_('Thinking')}
      </summary>
      <pre
        className={clsx(
          'text-base-content/55 mt-2.5 max-h-56 overflow-y-auto overscroll-contain',
          'whitespace-pre-wrap font-sans text-[0.9em] leading-[1.7]',
        )}
      >
        {reasoning}
      </pre>
    </details>
  );
}

function CopyMessageButton({ content, workedMs }: { content: string; workedMs?: number }) {
  const _ = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await writeTextToClipboard(content);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const duration = workedMs != null && workedMs > 0 ? formatWorkDuration(workedMs) : null;

  return (
    <div className='text-base-content/40 mt-2 flex items-center gap-1.5 font-sans text-[0.8em] leading-none select-none'>
      <button
        type='button'
        className={clsx(
          'hover:text-base-content inline-flex items-center justify-center',
          'transition-colors',
          focusRing,
        )}
        aria-label={copied ? _('Copied') : _('Copy')}
        onClick={() => {
          void handleCopy();
        }}
      >
        {copied ? (
          <CheckIcon size={12} aria-hidden='true' />
        ) : (
          <CopyIcon size={12} aria-hidden='true' />
        )}
      </button>
      {duration ? (
        <>
          <span className='text-base-content/25' aria-hidden='true'>
            ·
          </span>
          <span className='tabular-nums tracking-wide'>{duration}</span>
        </>
      ) : null}
    </div>
  );
}

function assistantWorkedMs(
  messages: EveMessage[],
  index: number,
  opts: { live: boolean },
): number | undefined {
  const msg = messages[index];
  if (!msg || msg.role !== 'assistant') return undefined;
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = messages[i];
    if (prev?.role !== 'user') continue;
    const end = opts.live ? Date.now() : msg.createdAt;
    const ms = end - prev.createdAt;
    return ms > 0 ? ms : undefined;
  }
  return undefined;
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
    <div className='border-base-200/70 flex shrink-0 flex-col gap-2 border-b px-3 py-2.5'>
      <div className='text-base-content/45 flex items-center justify-between text-[0.8em] leading-none select-none'>
        <span>
          {_('Pending quotes')} <span className='tabular-nums'>({quotes.length})</span>
        </span>
        <button
          type='button'
          className={clsx(
            'hover:text-base-content rounded-md px-1.5 py-1 hover:bg-base-200/60',
            focusRing,
          )}
          onClick={onClear}
        >
          {_('Clear all')}
        </button>
      </div>
      <ul className='flex flex-col gap-1.5'>
        {quotes.map((q) => {
          const full = q.chapterTitle ? `${q.text} · 《${q.chapterTitle}》` : q.text;
          return (
            <li
              key={q.id}
              className={clsx(
                'bg-base-100/55 eink-bordered border-base-200/70 flex items-start gap-1 rounded-md border',
                'py-1.5 ps-2 pe-1',
              )}
            >
              <span
                className='border-base-content/25 text-base-content/40 mt-px shrink-0 border-s-2 ps-2 select-none'
                aria-hidden='true'
              >
                ❝
              </span>
              <span
                className='text-base-content/80 line-clamp-2 min-w-0 flex-1 text-[0.85em] leading-snug select-text'
                title={full}
              >
                {q.text}
                {q.chapterTitle ? (
                  <span className='text-base-content/45'> · 《{q.chapterTitle}》</span>
                ) : null}
              </span>
              <button
                type='button'
                className={clsx(
                  'text-base-content/40 hover:text-base-content hover:bg-base-200/80',
                  'relative flex size-6 shrink-0 items-center justify-center rounded-full',
                  'after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2',
                  focusRing,
                )}
                aria-label={_('Remove quote')}
                onClick={() => onRemove(q.id)}
              >
                <XIcon size={13} aria-hidden='true' />
              </button>
            </li>
          );
        })}
      </ul>
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

  const modelConfig = mergeModelConfig(settings.modelConfig);
  const activeProfile = getActiveProfile(modelConfig);
  const thinkingMode = settings.thinkingMode === 'think' ? 'think' : 'fast';

  const agent = useEveAgent({
    bookId,
    bookTitle,
    sessionId,
    thinkingMode,
  });

  const prevAgentSessionIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const previousAgentSessionId = prevAgentSessionIdRef.current;
    prevAgentSessionIdRef.current = agent.sessionId;
    if (
      shouldPushAgentSessionToStore({
        agentSessionId: agent.sessionId,
        previousAgentSessionId,
        storeSessionId: activeSessionId,
        storeBookId: activeBookId,
        bookId,
      })
    ) {
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
  const showPendingReply = shouldShowPendingReply(busy, agent.messages);
  const lookingUp = showPendingReply && agent.inFlightTools.length > 0;

  const handleSend = useCallback(() => {
    if (!agent.composer.trim() || busy) return;
    const quotes = useReadingAssistantStore.getState().pendingQuotes;
    clearPendingQuotes();
    void agent.send({
      quotes,
      onSendFailed: restorePendingQuotes,
    });
  }, [agent, busy, clearPendingQuotes, restorePendingQuotes]);

  const handleSelectThinkingMode = useCallback(
    (mode: 'think' | 'fast') => {
      if (mode === thinkingMode) return;
      void saveSysSettings(envConfig, 'thinkingMode', mode);
    },
    [envConfig, thinkingMode],
  );

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
    <div className='flex h-full min-h-0 flex-col overscroll-contain'>
      <PendingQuoteBar
        quotes={pendingQuotes}
        onRemove={removePendingQuote}
        onClear={clearPendingQuotes}
      />
      <div
        className='min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain px-4 py-5 touch-pan-y'
        aria-live='polite'
        aria-relevant='additions'
      >
        {agent.messages.map((msg, index) => {
          const isLiveAssistant =
            busy && msg.role === 'assistant' && index === agent.messages.length - 1;
          const workedMs =
            msg.role === 'assistant' && (msg.content.trim() || msg.reasoning?.trim())
              ? assistantWorkedMs(agent.messages, index, { live: isLiveAssistant })
              : undefined;
          return (
            <div
              key={msg.id}
              className={clsx(
                messageTypeClass,
                msg.role === 'user'
                  ? 'bg-base-100/70 ms-5 select-text rounded-xl px-3.5 py-3 break-words whitespace-pre-wrap'
                  : 'me-1 select-text px-0.5 py-0.5',
              )}
            >
              {msg.role === 'user' && msg.quotes?.length ? (
                <QuoteStack quotes={msg.quotes} />
              ) : null}
              {msg.role === 'assistant' ? (
                <div className={markdownBodyClass}>
                  {msg.reasoning?.trim() ? <ReasoningBlock reasoning={msg.reasoning} /> : null}
                  {msg.content.trim() ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={createAssistantMarkdownComponents({
                        bookKey,
                        sources: msg.sources,
                      })}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : null}
                </div>
              ) : (
                <div>{msg.content}</div>
              )}
              {msg.role === 'assistant' && msg.sources?.length ? (
                <MessageSources bookKey={bookKey} sources={msg.sources} />
              ) : null}
              {msg.role === 'assistant' && msg.tools?.length ? (
                <ToolTrace tools={msg.tools} />
              ) : null}
              {msg.role === 'assistant' && msg.content.trim() ? (
                <CopyMessageButton content={msg.content} workedMs={workedMs} />
              ) : null}
            </div>
          );
        })}
        {showPendingReply ? <PendingReplyDots lookingUp={lookingUp} /> : null}
        {agent.error ? (
          <p className={clsx('text-error select-text text-pretty', messageTypeClass)} role='alert'>
            {agent.error.message}
          </p>
        ) : null}
      </div>
      <form
        className='shrink-0 px-2.5 pb-2.5 pt-1'
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <div className='bg-base-100 eink-bordered focus-within:ring-base-content/15 flex flex-col rounded-xl focus-within:ring-2'>
          <textarea
            name='assistant-message'
            aria-label={_('Message')}
            autoComplete='off'
            spellCheck
            className={clsx(
              'min-h-[48px] w-full resize-none bg-transparent px-3.5 py-2.5 outline-none',
              messageTypeClass,
            )}
            value={agent.composer}
            onChange={(e) => agent.setComposer(e.target.value)}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                // Busy: keep typing (soft keyboard stays open); only block submit.
                if (busy) return;
                handleSend();
              }
            }}
          />
          <div className='flex items-center gap-0.5 px-2 pb-2 pt-0.5 font-sans text-sm select-none touch-manipulation'>
            <div
              className={clsx('dropdown dropdown-top', busy && 'pointer-events-none opacity-50')}
            >
              <button
                type='button'
                tabIndex={0}
                className={clsx(composerSelectTrigger, 'max-w-[9.5rem]', focusRing)}
                disabled={busy}
                aria-label={_('Model')}
                aria-haspopup='listbox'
                onClick={(e) => e.currentTarget.focus()}
              >
                <span className='truncate' translate='no'>
                  {activeProfile?.name ?? _('Model')}
                </span>
                <ChevronUpIcon size={12} className='shrink-0 opacity-40' aria-hidden='true' />
              </button>
              <ul
                tabIndex={0}
                role='listbox'
                className={clsx(composerSelectMenu, 'max-h-48 min-w-[10rem]')}
              >
                {modelConfig.profiles.map((profile) => {
                  const isActive = profile.id === modelConfig.activeProfileId;
                  return (
                    <li key={profile.id} role='option' aria-selected={isActive}>
                      <button
                        type='button'
                        className={clsx(composerSelectItem, focusRing)}
                        onClick={() => {
                          void handleSelectProfile(profile.id);
                          (document.activeElement as HTMLElement | null)?.blur();
                        }}
                      >
                        <span className='flex w-3.5 shrink-0 justify-center'>
                          {isActive ? (
                            <CheckIcon size={13} className='opacity-70' aria-hidden='true' />
                          ) : null}
                        </span>
                        <span className='truncate' translate='no'>
                          {profile.name}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div
              className={clsx('dropdown dropdown-top', busy && 'pointer-events-none opacity-50')}
            >
              <button
                type='button'
                tabIndex={0}
                className={clsx(composerSelectTrigger, focusRing)}
                disabled={busy}
                aria-label={thinkingMode === 'think' ? _('Think') : _('Fast')}
                aria-haspopup='listbox'
                onClick={(e) => e.currentTarget.focus()}
              >
                <span className='truncate'>
                  {thinkingMode === 'think' ? _('Think') : _('Fast')}
                </span>
                <ChevronUpIcon size={12} className='shrink-0 opacity-40' aria-hidden='true' />
              </button>
              <ul tabIndex={0} role='listbox' className={clsx(composerSelectMenu, 'min-w-[7rem]')}>
                {(
                  [
                    { id: 'think' as const, label: _('Think') },
                    { id: 'fast' as const, label: _('Fast') },
                  ] as const
                ).map((option) => {
                  const isActive = option.id === thinkingMode;
                  return (
                    <li key={option.id} role='option' aria-selected={isActive}>
                      <button
                        type='button'
                        className={clsx(composerSelectItem, focusRing)}
                        onClick={() => {
                          handleSelectThinkingMode(option.id);
                          (document.activeElement as HTMLElement | null)?.blur();
                        }}
                      >
                        <span className='flex w-3.5 shrink-0 justify-center'>
                          {isActive ? (
                            <CheckIcon size={13} className='opacity-70' aria-hidden='true' />
                          ) : null}
                        </span>
                        <span>{option.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <button
              type={busy ? 'button' : 'submit'}
              className={clsx(
                composerPrimaryBtn,
                busy || canSend ? composerPrimaryBtnLive : composerPrimaryBtnIdle,
                focusRing,
              )}
              aria-label={busy ? _('Stop') : _('Send')}
              disabled={!busy && !canSend}
              onClick={
                busy
                  ? (e) => {
                      e.preventDefault();
                      agent.stop();
                    }
                  : undefined
              }
            >
              {busy ? (
                <span className='bg-base-100 block size-[9px] rounded-[2px]' aria-hidden='true' />
              ) : (
                <ArrowUpIcon size={14} strokeWidth={2.25} aria-hidden='true' />
              )}
            </button>
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
  // Saving a key reloads the sidecar and refreshes this store; re-check keychain then.
  const info = useEveConnectionStore((s) => s.info);
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
  }, [appService, activeProfileId, ready, info]);

  const available = isReadingAssistantAvailable({
    modelEnabled: modelConfig?.enabled ?? false,
    sidecarReady: ready,
    hasActiveProfile: Boolean(activeProfileId),
    hasApiKey: hasKey,
  });

  const bookId = bookData?.book?.hash || '';
  const bookTitle = bookData?.book?.title || '';

  if (!available) {
    return (
      <div className='text-base-content/70 flex h-full flex-col items-center justify-center gap-2 p-4 text-center leading-relaxed'>
        {!ready ? (
          <Loader2Icon
            className='animate-spin select-none motion-reduce:animate-none'
            size={20}
            aria-hidden='true'
          />
        ) : null}
        <p className='select-text text-pretty' aria-live='polite'>
          {_(
            'Enable Reading Assistant in Settings, add an API key, and wait for the local sidecar to start.',
          )}
        </p>
      </div>
    );
  }

  if (!bookId) {
    return (
      <div className='text-base-content/70 flex h-full items-center justify-center p-4 select-text text-pretty leading-relaxed'>
        {_('Open a book to chat with the Reading Assistant.')}
      </div>
    );
  }

  // Key only on bookId — not activeSessionId. First send creates a session and
  // writes it to the store; a sessionId key remount would drop the in-flight stream.
  // Session switches (History / New chat) are handled by useEveAgent's load effect.
  return (
    <ReadingAssistantChat key={bookId} bookKey={bookKey} bookId={bookId} bookTitle={bookTitle} />
  );
};

export default AIAssistant;
