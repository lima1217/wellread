'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronUpIcon,
  NotebookPenIcon,
  PencilIcon,
  RotateCcwIcon,
  XIcon,
} from 'lucide-react';
import type { PendingQuoteForTurn } from '@wellread/quote-wire';
import clsx from 'clsx';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { uniqueId } from '@/utils/misc';
import { exportBookAnnotations } from '@/services/wellread/assistant/annotationsExport';
import { createAppServiceExtractFs } from '@/services/wellread/extract/ensureExtractForOpenedBook';
import { buildSpineChapterTitleLookup } from '@/services/wellread/extract/spineChapterTitles';
import { useEnv } from '@/context/EnvContext';
import { saveSysSettings } from '@/helpers/settings';
import {
  getActiveProfile,
  mergeModelConfig,
  setActiveProfile,
} from '@/services/wellread/modelConfig';
import {
  isComposerTextInputDisabled,
  shouldBlockComposerSubmit,
} from '@/services/wellread/assistant/composerBusyPolicy';
import { reloadEveIfNeeded } from '@/services/wellread/assistant/reloadEveIfNeeded';
import {
  shouldPushAgentSessionToStore,
  shouldShowPendingReply,
} from '@/services/wellread/assistant/sessionUi';
import { isPersistedMessageId, useEveAgent } from '@/services/wellread/assistant/useEveAgent';
import {
  useReadingAssistantStore,
  type PendingQuote,
} from '@/services/wellread/assistant/readingAssistantStore';
import { AssistantPartsView } from './AssistantPartsView';
import {
  assistantWorkedMs,
  CopyMessageButton,
  copySelectionWithoutCitations,
  MessageActionButton,
  PendingQuoteBar,
  PendingReplyDots,
  QuoteStack,
} from './AssistantMessageChrome';
import { markdownBodyClass, messageTypeClass, focusRing } from './AssistantMarkdown';
import {
  ComposerSelectCheck,
  ComposerSlashMenu,
  composerSelectItem,
  composerSelectItemActive,
  composerSelectMenu,
  composerSelectTrigger,
  useComposerSlash,
} from './ComposerSlash';

/** Shared circular action: solid when Send/Stop is live, muted when idle. */
const composerPrimaryBtn =
  'ms-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150';
const composerPrimaryBtnLive = 'bg-base-content text-base-100 hover:opacity-90';
const composerPrimaryBtnIdle = 'bg-base-200/70 text-base-content/30';

/** Quotes stored on a sent user message → live-bar shape for a resend. */
function toPendingQuotes(quotes: PendingQuoteForTurn[] | undefined): PendingQuote[] {
  return (quotes ?? []).map((q) => ({
    id: q.id ?? uniqueId(),
    text: q.text,
    chapterTitle: q.chapterTitle ?? null,
    ...(q.cfi ? { cfi: q.cfi } : {}),
  }));
}

export const ReadingAssistantChat = ({
  bookKey,
  bookId,
  bookTitle,
  isActive = true,
}: {
  bookKey: string;
  bookId: string;
  bookTitle: string;
  isActive?: boolean;
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
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
  const spoilerGuard = settings.assistantSpoilerGuard === true;
  const shareAnnotations = settings.assistantShareAnnotations !== false;

  // Refresh Books/.wellread/annotations/<bookId>.md before each turn; when
  // sharing is off the export is emptied so the sidecar stops advertising it.
  const beforeTurn = useCallback(async () => {
    if (!appService) return;
    const { getConfig, getBookData } = useBookDataStore.getState();
    const bookDoc = getBookData(bookKey)?.bookDoc;
    await exportBookAnnotations({
      fs: createAppServiceExtractFs(appService),
      bookId,
      bookTitle,
      booknotes: shareAnnotations ? (getConfig(bookKey)?.booknotes ?? []) : [],
      getChapterTitle: bookDoc ? buildSpineChapterTitleLookup(bookDoc) : undefined,
    });
  }, [appService, bookId, bookKey, bookTitle, shareAnnotations]);

  const agent = useEveAgent({
    bookId,
    bookTitle,
    sessionId,
    thinkingMode,
    spoilerGuard,
    beforeTurn,
    getReaderState: () => {
      const progress = useReaderStore.getState().getProgress(bookKey);
      if (!progress?.location && !progress?.sectionLabel) return null;
      const sectionIndex =
        typeof progress.index === 'number' && Number.isFinite(progress.index) && progress.index >= 0
          ? Math.floor(progress.index)
          : undefined;
      return {
        ...(progress.sectionLabel ? { chapter: progress.sectionLabel } : {}),
        ...(progress.location ? { cfi: progress.location } : {}),
        ...(sectionIndex !== undefined ? { sectionIndex } : {}),
      };
    },
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

  useEffect(() => {
    const state = useReadingAssistantStore.getState();
    if (state.pendingQuotes.length > 0 && state.activeBookId && state.activeBookId !== bookId) {
      state.clearPendingQuotes();
    }
  }, [bookId]);

  const busy = agent.status === 'submitted' || agent.status === 'streaming';
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const canSend = Boolean(agent.composer.trim()) && !shouldBlockComposerSubmit(busy);
  const showPendingReply = shouldShowPendingReply(busy, agent.messages);

  /** Edit-and-resend target: the user turn being replaced and its quotes. */
  const [editing, setEditing] = useState<{ id: string; quotes: PendingQuote[] } | null>(null);
  useEffect(() => {
    setEditing(null);
  }, [sessionId]);

  const handleSend = useCallback(() => {
    if (!agent.composer.trim() || shouldBlockComposerSubmit(busy)) return;
    const pending = useReadingAssistantStore.getState().pendingQuotes;
    clearPendingQuotes();
    const target = editing;
    setEditing(null);
    stickToBottomRef.current = true;
    void agent.send({
      quotes: target ? [...target.quotes, ...pending] : pending,
      onSendFailed: restorePendingQuotes,
      ...(target ? { truncateFrom: target.id } : {}),
    });
  }, [agent, busy, clearPendingQuotes, editing, restorePendingQuotes]);

  /** One-click turns (starters, save note): attach the live Pending Quotes. */
  const sendPreset = useCallback(
    (message: string) => {
      if (shouldBlockComposerSubmit(busy)) return;
      const quotes = useReadingAssistantStore.getState().pendingQuotes;
      clearPendingQuotes();
      stickToBottomRef.current = true;
      void agent.send({ message, quotes, onSendFailed: restorePendingQuotes });
    },
    [agent, busy, clearPendingQuotes, restorePendingQuotes],
  );

  const lastUser = [...agent.messages].reverse().find((m) => m.role === 'user');
  const canRegenerate = Boolean(lastUser && isPersistedMessageId(lastUser.id)) && !busy;
  const handleRegenerate = useCallback(() => {
    if (!lastUser || !isPersistedMessageId(lastUser.id) || shouldBlockComposerSubmit(busy)) return;
    setEditing(null);
    stickToBottomRef.current = true;
    void agent.send({
      message: lastUser.content,
      quotes: toPendingQuotes(lastUser.quotes),
      truncateFrom: lastUser.id,
    });
  }, [agent, busy, lastUser]);

  const starters = [
    { label: _('Summarize this chapter'), message: _('Summarize the chapter I am reading.') },
    {
      label: _('Explain this page'),
      message: `/skill:explain ${_('the passage I am reading now')}`,
    },
    { label: _('Quiz me'), message: '/skill:socratic-check' },
    ...(shareAnnotations
      ? [
          {
            label: _('Review my highlights'),
            message: _('What do my highlights and notes in this book add up to?'),
          },
        ]
      : []),
  ];

  const slash = useComposerSlash({
    composer: agent.composer,
    setComposer: agent.setComposer,
    busy,
    onSubmit: handleSend,
  });

  useEffect(() => {
    if (!isActive) return;
    slash.composerRef.current?.focus({ preventScroll: true });
  }, [isActive, slash.composerRef]);

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
      await reloadEveIfNeeded(next, { previousActiveId, editedProfileId: null });
    },
    [busy, envConfig, modelConfig, saveSettings, setSettings, settings],
  );

  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
    setShowJumpToLatest(false);
  }, [agent.messages, showPendingReply, agent.error]);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  // Grow the composer with its content up to a cap, then scroll inside it.
  useEffect(() => {
    const el = slash.composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [agent.composer, slash.composerRef]);

  const cancelEditing = useCallback(() => {
    setEditing(null);
    agent.setComposer('');
  }, [agent]);

  return (
    <div className='relative flex h-full min-h-0 flex-col overscroll-contain'>
      <PendingQuoteBar
        quotes={pendingQuotes}
        onRemove={removePendingQuote}
        onClear={clearPendingQuotes}
      />
      <div
        ref={scrollRef}
        className='min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain px-4 py-5 touch-pan-y'
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          stickToBottomRef.current = atBottom;
          setShowJumpToLatest(!atBottom);
        }}
      >
        {agent.messages.length === 0 && !busy ? (
          <div className='flex flex-col items-start gap-2 pt-2 font-sans'>
            <p className='text-base-content/50 text-sm'>{_('Ask about this book, or try:')}</p>
            <div className='flex flex-wrap gap-1.5'>
              {starters.map((s) => (
                <button
                  key={s.label}
                  type='button'
                  className={clsx(
                    'eink-bordered border-base-content/15 hover:bg-base-200 rounded-full border px-3 py-1 text-sm transition-colors',
                    focusRing,
                  )}
                  onClick={() => sendPreset(s.message)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
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
                  : 'me-1 max-w-[65ch] select-text px-0.5 py-0.5',
              )}
            >
              {msg.role === 'user' && msg.quotes?.length ? (
                <QuoteStack quotes={msg.quotes} />
              ) : null}
              {msg.role === 'assistant' ? (
                <div className={markdownBodyClass} onCopy={copySelectionWithoutCitations}>
                  <AssistantPartsView msg={msg} bookKey={bookKey} isLive={isLiveAssistant} />
                </div>
              ) : (
                <div>{msg.content}</div>
              )}
              {msg.role === 'user' && !busy && isPersistedMessageId(msg.id) ? (
                <div className='text-base-content/40 -mb-1 mt-1 flex justify-end'>
                  <MessageActionButton
                    label={_('Edit and resend')}
                    onClick={() => {
                      setEditing({ id: msg.id, quotes: toPendingQuotes(msg.quotes) });
                      agent.setComposer(msg.content);
                      slash.composerRef.current?.focus();
                    }}
                  >
                    <PencilIcon size={12} aria-hidden='true' />
                  </MessageActionButton>
                </div>
              ) : null}
              {msg.role === 'assistant' && msg.content.trim() ? (
                <CopyMessageButton content={msg.content} workedMs={workedMs}>
                  {index === agent.messages.length - 1 && !busy ? (
                    <>
                      <MessageActionButton
                        label={_('Regenerate')}
                        disabled={!canRegenerate}
                        onClick={handleRegenerate}
                      >
                        <RotateCcwIcon size={12} aria-hidden='true' />
                      </MessageActionButton>
                      <MessageActionButton
                        label={_('Save to notes')}
                        onClick={() =>
                          sendPreset(
                            `/skill:note ${_('Save your previous answer to my notes (write directly).')}`,
                          )
                        }
                      >
                        <NotebookPenIcon size={12} aria-hidden='true' />
                      </MessageActionButton>
                    </>
                  ) : null}
                </CopyMessageButton>
              ) : null}
            </div>
          );
        })}
        {showPendingReply ? <PendingReplyDots /> : null}
        {agent.error ? (
          <p className={clsx('text-error select-text text-pretty', messageTypeClass)} role='alert'>
            {agent.error.message}
          </p>
        ) : null}
      </div>
      {showJumpToLatest && agent.messages.length > 0 ? (
        <div className='pointer-events-none relative z-10 flex h-0 justify-center'>
          <button
            type='button'
            className={clsx(
              'bg-base-100 eink-bordered border-base-200 text-base-content/70 hover:text-base-content',
              'pointer-events-auto absolute -top-10 flex size-8 items-center justify-center rounded-full border',
              'shadow-[0_1px_2px_oklch(0_0_0/0.06),0_4px_14px_oklch(0_0_0/0.08)] transition-colors',
              focusRing,
            )}
            aria-label={_('Jump to latest')}
            title={_('Jump to latest')}
            onClick={jumpToLatest}
          >
            <ArrowDownIcon size={15} aria-hidden='true' />
          </button>
        </div>
      ) : null}
      <form
        className='shrink-0 px-2.5 pb-2.5 pt-1'
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        {editing ? (
          <div className='text-base-content/60 flex items-center gap-1.5 px-1.5 pb-1 font-sans text-xs'>
            <PencilIcon size={11} aria-hidden='true' />
            <span className='flex-1'>
              {_('Editing: sending replaces this message and later replies')}
            </span>
            <MessageActionButton label={_('Cancel editing')} onClick={cancelEditing}>
              <XIcon size={12} aria-hidden='true' />
            </MessageActionButton>
          </div>
        ) : null}
        <div className='bg-base-100 eink-bordered focus-within:ring-base-content/15 relative flex flex-col rounded-xl focus-within:ring-2'>
          <ComposerSlashMenu
            open={slash.slashOpen}
            skills={slash.skills}
            skillsLoaded={slash.skillsLoaded}
            skillsError={slash.skillsError}
            slashMatches={slash.slashMatches}
            activeSlashIndex={slash.activeSlashIndex}
            onSetIndex={slash.setSlashIndex}
            onSelect={slash.selectSlashSkill}
          />
          <textarea
            ref={slash.composerRef}
            name='assistant-message'
            aria-label={_('Message')}
            autoComplete='off'
            spellCheck
            disabled={isComposerTextInputDisabled(busy)}
            className={clsx(
              'max-h-[200px] min-h-[48px] w-full resize-none overflow-y-auto bg-transparent px-3.5 py-2.5 outline-none',
              messageTypeClass,
            )}
            value={agent.composer}
            onChange={(e) => slash.handleComposerChange(e.target.value)}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && editing && !slash.slashOpen) {
                e.preventDefault();
                cancelEditing();
                return;
              }
              slash.handleComposerKeyDown(e);
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
                  {activeProfile?.modelId ?? _('Model')}
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
                    <li
                      key={profile.id}
                      role='option'
                      aria-selected={isActive}
                      tabIndex={0}
                      className={clsx(
                        composerSelectItem,
                        focusRing,
                        isActive && composerSelectItemActive,
                      )}
                      onClick={() => {
                        void handleSelectProfile(profile.id);
                        (document.activeElement as HTMLElement | null)?.blur();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void handleSelectProfile(profile.id);
                          (document.activeElement as HTMLElement | null)?.blur();
                        }
                      }}
                    >
                      <ComposerSelectCheck active={isActive} />
                      <span className='min-w-0 flex-1 truncate' translate='no'>
                        {profile.modelId}
                      </span>
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
              <ul
                tabIndex={0}
                role='listbox'
                className={clsx(composerSelectMenu, 'min-w-[7.5rem]')}
              >
                {(
                  [
                    { id: 'think' as const, label: _('Think') },
                    { id: 'fast' as const, label: _('Fast') },
                  ] as const
                ).map((option) => {
                  const isActive = option.id === thinkingMode;
                  return (
                    <li
                      key={option.id}
                      role='option'
                      aria-selected={isActive}
                      tabIndex={0}
                      className={clsx(
                        composerSelectItem,
                        focusRing,
                        isActive && composerSelectItemActive,
                      )}
                      onClick={() => {
                        handleSelectThinkingMode(option.id);
                        (document.activeElement as HTMLElement | null)?.blur();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectThinkingMode(option.id);
                          (document.activeElement as HTMLElement | null)?.blur();
                        }
                      }}
                    >
                      <ComposerSelectCheck active={isActive} />
                      <span className='min-w-0 flex-1 truncate'>{option.label}</span>
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
