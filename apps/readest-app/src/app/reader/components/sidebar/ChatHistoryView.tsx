'use client';

import clsx from 'clsx';
import dayjs from 'dayjs';
import React, { useCallback, useEffect, useState } from 'react';
import { LuMessageSquare, LuTrash2, LuPlus } from 'react-icons/lu';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import {
  createEveSession,
  deleteEveSession,
  listEveSessions,
  type EveSessionMeta,
} from '@/services/wellread/assistant/eveClient';
import { useReadingAssistantStore } from '@/services/wellread/assistant/readingAssistantStore';
import { useEveConnectionStore } from '@/services/wellread/eveConnectionStore';

interface ChatHistoryViewProps {
  bookKey: string;
  /** Called after selecting or creating a session (return to chat pane). */
  onSessionOpen: () => void;
}

const ChatHistoryView: React.FC<ChatHistoryViewProps> = ({ bookKey, onSessionOpen }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const setActiveSession = useReadingAssistantStore((s) => s.setActiveSession);
  const clearPendingQuotes = useReadingAssistantStore((s) => s.clearPendingQuotes);
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
  const bookTitle = bookData?.book?.title || 'Unknown';

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

  const handleNew = useCallback(async () => {
    if (!bookId) return;
    clearPendingQuotes();
    const session = await createEveSession({
      bookId,
      bookTitle,
      title: `Chat about ${bookTitle}`,
    });
    setActiveSession(session.id, bookId);
    onSessionOpen();
    await reload();
  }, [bookId, bookTitle, reload, setActiveSession, clearPendingQuotes, onSessionOpen]);

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
      <div className='text-base-content/60 p-4 text-sm'>
        {_('Reading Assistant sidecar is starting…')}
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center justify-between px-3 py-2'>
        <span className='text-sm font-medium'>{_('Chat History')}</span>
        <button
          type='button'
          className='btn btn-ghost btn-xs'
          onClick={() => void handleNew()}
          title={_('New chat')}
          aria-label={_('New chat')}
        >
          <LuPlus size={16} />
        </button>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        {loading ? (
          <div className='text-base-content/60 p-4 text-sm'>{_('Loading…')}</div>
        ) : sessions.length === 0 ? (
          <div className='text-base-content/60 p-4 text-sm'>{_('No chats for this book yet.')}</div>
        ) : (
          <ul className='space-y-0.5 px-1'>
            {sessions.map((session) => (
              <li key={session.id}>
                <div
                  role='button'
                  tabIndex={0}
                  className={clsx(
                    'hover:bg-base-200/70 group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2',
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
                  <LuMessageSquare className='text-base-content/50 shrink-0' size={16} />
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm'>{session.title}</div>
                    <div className='text-base-content/50 text-xs'>
                      {dayjs(session.updatedAt).format('MMM D, HH:mm')}
                    </div>
                  </div>
                  <button
                    type='button'
                    className='btn btn-ghost btn-xs opacity-0 group-hover:opacity-100'
                    onClick={(e) => void handleDelete(e, session.id)}
                    aria-label={_('Delete')}
                  >
                    <LuTrash2 size={14} />
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
