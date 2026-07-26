import clsx from 'clsx';
import React from 'react';

import { LuHistory, LuPlus } from 'react-icons/lu';
import { MdArrowBackIosNew, MdOutlinePushPin, MdPushPin } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

const AssistantHeader: React.FC<{
  isPinned: boolean;
  pane: 'chat' | 'history';
  handleClose: () => void;
  handleTogglePin: () => void;
  onOpenHistory: () => void;
  onBackToChat: () => void;
  onNewSession: () => void;
}> = ({
  isPinned,
  pane,
  handleClose,
  handleTogglePin,
  onOpenHistory,
  onBackToChat,
  onNewSession,
}) => {
  const _ = useTranslation();
  const iconSize15 = useResponsiveSize(15);
  const isHistory = pane === 'history';
  const pressScaleClass =
    'not-eink:active:scale-[0.96] not-eink:transition-transform not-eink:duration-150 not-eink:ease-out';

  return (
    <div
      className='assistant-header relative flex h-11 items-center px-3 select-none touch-manipulation'
      dir='ltr'
    >
      {/* Inset + truncate so the title stays clear of flanking controls at narrow widths. */}
      <div className='pointer-events-none absolute inset-x-20 inset-y-0 z-0 flex items-center justify-center sm:inset-x-24'>
        <h2
          className={clsx(
            'assistant-title truncate text-center text-base font-medium tracking-tight',
            isHistory && 'text-base-content/60',
          )}
        >
          {isHistory ? _('Chat History') : _('Reading Assistant')}
        </h2>
      </div>
      <div className='relative z-10 flex w-full items-center gap-x-1.5'>
        <button
          type='button'
          title={isPinned ? _('Unpin AI') : _('Pin AI')}
          aria-label={isPinned ? _('Unpin AI') : _('Pin AI')}
          aria-pressed={isPinned}
          onClick={handleTogglePin}
          className={clsx(
            'btn btn-ghost btn-circle hidden h-8 min-h-8 w-8 sm:flex',
            pressScaleClass,
            isPinned ? 'bg-base-300' : 'bg-base-300/50',
          )}
        >
          {isPinned ? (
            <MdPushPin size={iconSize15} aria-hidden='true' />
          ) : (
            <MdOutlinePushPin size={iconSize15} aria-hidden='true' />
          )}
        </button>
        <button
          type='button'
          title={_('Close')}
          aria-label={_('Close')}
          onClick={handleClose}
          className={clsx(
            'btn btn-ghost btn-circle flex h-8 min-h-8 w-8 hover:bg-transparent sm:hidden',
            pressScaleClass,
          )}
        >
          <MdArrowBackIosNew aria-hidden='true' />
        </button>
        {isHistory ? (
          <button
            type='button'
            title={_('Back to chat')}
            aria-label={_('Back to chat')}
            onClick={onBackToChat}
            className={clsx(
              'btn btn-ghost btn-sm h-8 min-h-8 gap-1 rounded-full ps-2 pe-2.5',
              'text-[0.85em] leading-none whitespace-nowrap',
              pressScaleClass,
            )}
          >
            ← {_('Chat')}
          </button>
        ) : (
          <button
            type='button'
            title={_('Chat History')}
            aria-label={_('Chat History')}
            onClick={onOpenHistory}
            className={clsx('btn btn-ghost btn-circle h-8 min-h-8 w-8', pressScaleClass)}
          >
            <LuHistory size={iconSize15} aria-hidden='true' />
          </button>
        )}
        <div className='flex-1' />
        <button
          type='button'
          title={_('New chat')}
          aria-label={_('New chat')}
          onClick={onNewSession}
          className={clsx('btn btn-ghost btn-circle h-8 min-h-8 w-8', pressScaleClass)}
        >
          <LuPlus size={iconSize15} aria-hidden='true' />
        </button>
      </div>
    </div>
  );
};

export default AssistantHeader;
