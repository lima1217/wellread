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
import { getLocale } from '@/utils/misc';

interface ChatHistoryViewProps {
  bookKey: string;
  /** Called after selecting a session (return to chat pane). */
  onSessionOpen: () => void;
}

function formatSessionTime(updatedAt: string | number | Date): string {
  return new Intl.DateTimeFormat(getLocale(), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(updatedAt));
}

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
        await deleteEveSession(id);
        if (activeSessionId === id) setActiveSession(null, bookId);
        await reload();
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
          <div className='text-base-content/60 p-4 text-pretty leading-relaxed'>
            {_('No chats for this book yet.')}
          </div>
        ) : (
          <ul className='space-y-0.5 px-1'>
            {sessions.map((session) => (
              <li key={session.id}>
                <div
                  role='button'
                  tabIndex={0}
                  className={clsx(
                    'hover:bg-base-200/70 focus-visible:ring-base-content/15 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 select-none',
                    'focus-visible:outline-none focus-visible:ring-2',
                    activeSessionId === session.id && 'bg-base-200',
                  )}
                  onClick={() => handleSelect(session)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(session);
                    }
                  }}
                >
                  <LuMessageSquare
                    className='text-base-content/50 shrink-0'
                    size={16}
                    aria-hidden='true'
                  />
                  <div className='min-w-0 flex-1'>
                    <div className='truncate font-medium leading-snug' title={session.title}>
                      {session.title}
                    </div>
                    <div className='text-base-content/55 text-[0.85em] leading-none tabular-nums'>
                      {formatSessionTime(session.updatedAt)}
                    </div>
                  </div>
                  <button
                    type='button'
                    className='btn btn-ghost btn-xs text-base-content/55'
                    onClick={(e) => void handleDelete(e, session.id)}
                    aria-label={_('Delete')}
                  >
                    <LuTrash2 size={14} aria-hidden='true' />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ChatHistoryView;
