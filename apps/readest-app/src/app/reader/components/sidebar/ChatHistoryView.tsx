'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useState } from 'react';
import { LuMessageSquare, LuTrash2 } from 'react-icons/lu';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import {
  deleteEveSession,
  listEveSessions,
  type EveSessionMeta,
} from '@/services/wellread/assistant/eveClient';
import { useReadingAssistantStore } from '@/services/wellread/assistant/readingAssistantStore';
import { useEveConnectionStore } from '@/services/wellread/eveConnectionStore';
import { eventDispatcher } from '@/utils/event';
import { getLocale } from '@/utils/misc';

interface ChatHistoryViewProps {
  bookKey: string;
  /** Called after selecting a session (return to chat pane). */
  onSessionOpen: () => void;
}

const SESSION_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

const sessionTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function getSessionTimeFormatter(locale: string): Intl.DateTimeFormat {
  let formatter = sessionTimeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, SESSION_TIME_FORMAT);
    sessionTimeFormatters.set(locale, formatter);
  }
  return formatter;
}

const pressScaleClass =
  'not-eink:active:scale-[0.96] not-eink:transition-transform not-eink:duration-150 not-eink:ease-out';

const ChatHistoryView: React.FC<ChatHistoryViewProps> = ({ bookKey, onSessionOpen }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const setActiveSession = useReadingAssistantStore((s) => s.setActiveSession);
  const activeSessionId = useReadingAssistantStore((s) => s.activeSessionId);
  const ready = useEveConnectionStore((s) => s.ready);
  const refresh = useEveConnectionStore((s) => s.refresh);

  const [sessions, setSessions] = useState<EveSessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  /** Client locale after mount — avoids SSR/browser Intl hydration mismatch. */
  const [timeLocale, setTimeLocale] = useState<string | null>(null);

  useEffect(() => {
    setTimeLocale(getLocale());
  }, []);

  const formatSessionTime = useCallback(
    (updatedAt: string | number | Date): string => {
      if (!timeLocale) return '';
      return getSessionTimeFormatter(timeLocale).format(new Date(updatedAt));
    },
    [timeLocale],
  );

  useEffect(() => {
    if (ready) return;
    void refresh();
  }, [ready, refresh]);

  const bookData = getBookData(bookKey);
  const bookId = bookData?.book?.hash || bookKey.split('-')[0] || '';

  const reload = useCallback(async () => {
    if (!bookId || !ready) {
      setSessions([]);
      return;
    }
    setLoading(true);
    try {
      setSessions(await listEveSessions(bookId));
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [bookId, ready]);

  useEffect(() => {
    void reload();
  }, [reload, activeSessionId]);

  const handleSelect = useCallback(
    (session: EveSessionMeta) => {
      setActiveSession(session.id, bookId);
      onSessionOpen();
    },
    [bookId, setActiveSession, onSessionOpen],
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      if (!appService) return;
      if (await appService.ask(_('Delete this conversation?'))) {
        try {
          await deleteEveSession(id);
          if (activeSessionId === id) setActiveSession(null, bookId);
          await reload();
        } catch (err) {
          eventDispatcher.dispatch('toast', {
            type: 'error',
            message: err instanceof Error ? err.message : _('Failed to delete conversation'),
          });
        }
      }
    },
    [appService, _, activeSessionId, bookId, reload, setActiveSession],
  );

  if (!ready) {
    return (
      <div className='text-base-content/60 p-4 text-pretty leading-relaxed' aria-live='polite'>
        {_('Reading Assistant sidecar is starting…')}
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col overscroll-contain'>
      <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
        {loading ? (
          <div className='text-base-content/60 p-4 text-pretty leading-relaxed' aria-live='polite'>
            {_('Loading…')}
          </div>
        ) : sessions.length === 0 ? (
          <div className='text-base-content/60 flex flex-col items-start gap-3 p-4 text-pretty leading-relaxed'>
            <div>
              <p className='text-base-content/80 font-medium'>{_('No chats for this book yet')}</p>
              <p className='mt-1 text-[0.92em]'>{_('Start a conversation from the chat panel.')}</p>
            </div>
            <button
              type='button'
              className={clsx(
                'btn btn-contrast h-9 min-h-0 rounded-lg px-4 text-sm font-medium',
                'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
                pressScaleClass,
              )}
              onClick={onSessionOpen}
            >
              {_('Back to chat')}
            </button>
          </div>
        ) : (
          <ul className='space-y-0.5 px-2 py-1'>
            {sessions.map((session, index) => {
              const isActive = activeSessionId === session.id;
              return (
                <li
                  key={session.id}
                  className='chat-history-row'
                  style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
                >
                  <div
                    className={clsx(
                      'group flex items-center gap-0.5 rounded-xl pe-0.5',
                      'transition-colors duration-150',
                      isActive ? 'bg-base-200' : 'hover:bg-base-200/70',
                    )}
                  >
                    <button
                      type='button'
                      className={clsx(
                        'flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 text-start select-none',
                        'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
                        pressScaleClass,
                      )}
                      onClick={() => handleSelect(session)}
                    >
                      <span
                        className={clsx(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                          'transition-colors duration-150',
                          isActive
                            ? 'bg-base-300 text-base-content/80'
                            : 'bg-base-200/80 text-base-content/55 group-hover:bg-base-300/60 group-hover:text-base-content/70',
                        )}
                        aria-hidden='true'
                      >
                        <LuMessageSquare size={15} />
                      </span>
                      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                        <div className='truncate font-medium leading-snug' title={session.title}>
                          {session.title}
                        </div>
                        <div className='text-base-content/55 text-[0.85em] leading-none tabular-nums'>
                          {formatSessionTime(session.updatedAt)}
                        </div>
                      </div>
                    </button>
                    <button
                      type='button'
                      className={clsx(
                        'touch-target btn btn-ghost btn-circle',
                        'text-base-content/45 hover:text-error',
                        'flex h-8 min-h-8 w-8 shrink-0 items-center justify-center',
                        pressScaleClass,
                      )}
                      onClick={(e) => void handleDelete(e, session.id)}
                      aria-label={_('Delete')}
                    >
                      <span
                        className={clsx(
                          'flex items-center justify-center',
                          'transition-[opacity,filter,transform] duration-300 ease-[cubic-bezier(0.2,0,0,1)]',
                          // Always visible on touch; reveal on hover for fine pointers.
                          'opacity-100 scale-100 blur-0',
                          'sm:opacity-0 sm:scale-[0.25] sm:blur-[4px]',
                          'sm:group-hover:scale-100 sm:group-hover:opacity-100 sm:group-hover:blur-0',
                          'sm:group-focus-within:scale-100 sm:group-focus-within:opacity-100 sm:group-focus-within:blur-0',
                        )}
                      >
                        <LuTrash2 size={15} aria-hidden='true' />
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ChatHistoryView;
