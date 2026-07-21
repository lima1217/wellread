import clsx from 'clsx';
import React from 'react';

import { LuHistory } from 'react-icons/lu';
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
}> = ({ isPinned, pane, handleClose, handleTogglePin, onOpenHistory, onBackToChat }) => {
  const _ = useTranslation();
  const iconSize15 = useResponsiveSize(15);
  const isHistory = pane === 'history';

  return (
    <div className='assistant-header relative flex h-11 items-center px-3' dir='ltr'>
      <div className='absolute inset-0 z-[-1] flex items-center justify-center'>
        <div
          className={clsx(
            'assistant-title text-sm font-medium',
            isHistory && 'text-base-content/60',
          )}
        >
          {isHistory ? _('Chat History') : _('Reading Assistant')}
        </div>
      </div>
      <div className='flex w-full items-center gap-x-2'>
        <button
          title={isPinned ? _('Unpin AI') : _('Pin AI')}
          onClick={handleTogglePin}
          className={clsx(
            'btn btn-ghost btn-circle hidden h-6 min-h-6 w-6 sm:flex',
            isPinned ? 'bg-base-300' : 'bg-base-300/65',
          )}
        >
          {isPinned ? <MdPushPin size={iconSize15} /> : <MdOutlinePushPin size={iconSize15} />}
        </button>
        <button
          title={_('Close')}
          onClick={handleClose}
          className={'btn btn-ghost btn-circle flex h-6 min-h-6 w-6 hover:bg-transparent sm:hidden'}
        >
          <MdArrowBackIosNew />
        </button>
        {isHistory ? (
          <button
            type='button'
            title={_('Back to chat')}
            aria-label={_('Back to chat')}
            onClick={onBackToChat}
            className='btn btn-ghost btn-sm h-7 min-h-7 gap-1 rounded-full px-2 text-xs'
          >
            ← {_('Chat')}
          </button>
        ) : (
          <button
            type='button'
            title={_('Chat History')}
            aria-label={_('Chat History')}
            onClick={onOpenHistory}
            className='btn btn-ghost btn-circle h-6 min-h-6 w-6'
          >
            <LuHistory size={iconSize15} />
          </button>
        )}
        <div className='flex-1' />
      </div>
    </div>
  );
};

export default AssistantHeader;
