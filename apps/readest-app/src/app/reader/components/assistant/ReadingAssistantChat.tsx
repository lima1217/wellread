'use client';

import { useCallback, useEffect, useRef } from 'react';
import { ArrowUpIcon, ChevronUpIcon } from 'lucide-react';
import clsx from 'clsx';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useEnv } from '@/context/EnvContext';
import { saveSysSettings } from '@/helpers/settings';
import {
  getActiveProfile,
  mergeModelConfig,
  setActiveProfile,
} from '@/services/wellread/modelConfig';
import { reloadEveIfNeeded } from '@/services/wellread/assistant/reloadEveIfNeeded';
import {
  shouldPushAgentSessionToStore,
  shouldShowPendingReply,
} from '@/services/wellread/assistant/sessionUi';
import { useEveAgent } from '@/services/wellread/assistant/useEveAgent';
import { useReadingAssistantStore } from '@/services/wellread/assistant/readingAssistantStore';
import { AssistantPartsView } from './AssistantPartsView';
import {
  assistantWorkedMs,
  CopyMessageButton,
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
  const canSend = Boolean(agent.composer.trim()) && !busy;
  const showPendingReply = shouldShowPendingReply(busy, agent.messages);

  const handleSend = useCallback(() => {
    if (!agent.composer.trim() || busy) return;
    const quotes = useReadingAssistantStore.getState().pendingQuotes;
    clearPendingQuotes();
    void agent.send({
      quotes,
      onSendFailed: restorePendingQuotes,
    });
  }, [agent, busy, clearPendingQuotes, restorePendingQuotes]);

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

  return (
    <div className='flex h-full min-h-0 flex-col overscroll-contain'>
      <PendingQuoteBar
        quotes={pendingQuotes}
        onRemove={removePendingQuote}
        onClear={clearPendingQuotes}
      />
      <div className='min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain px-4 py-5 touch-pan-y'>
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
                <div className={markdownBodyClass}>
                  <AssistantPartsView msg={msg} bookKey={bookKey} isLive={isLiveAssistant} />
                </div>
              ) : (
                <div>{msg.content}</div>
              )}
              {msg.role === 'assistant' && msg.content.trim() ? (
                <CopyMessageButton content={msg.content} workedMs={workedMs} />
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
      <form
        className='shrink-0 px-2.5 pb-2.5 pt-1'
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
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
            className={clsx(
              'min-h-[48px] w-full resize-none bg-transparent px-3.5 py-2.5 outline-none',
              messageTypeClass,
            )}
            value={agent.composer}
            onChange={(e) => slash.handleComposerChange(e.target.value)}
            rows={2}
            onKeyDown={slash.handleComposerKeyDown}
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
