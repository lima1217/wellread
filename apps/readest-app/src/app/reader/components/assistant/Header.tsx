import clsx from 'clsx';
import React from 'react';

import { LuPlus } from 'react-icons/lu';
import { MdArrowBackIosNew, MdOutlinePushPin, MdPushPin } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

export type AssistantPane = 'chat' | 'history' | 'notes' | 'aiNotes';

const AssistantHeader: React.FC<{
  isPinned: boolean;
  pane: AssistantPane;
  handleClose: () => void;
  handleTogglePin: () => void;
  onPaneChange: (pane: AssistantPane) => void;
  onNewSession: () => void;
}> = ({ isPinned, pane, handleClose, handleTogglePin, onPaneChange, onNewSession }) => {
  const _ = useTranslation();
  const iconSize15 = useResponsiveSize(15);
  const pressScaleClass =
    'not-eink:active:scale-[0.96] not-eink:transition-transform not-eink:duration-150 not-eink:ease-out';
  const tabs: { pane: AssistantPane; label: string }[] = [
    { pane: 'chat', label: _('Chat') },
    { pane: 'history', label: _('History') },
    { pane: 'notes', label: _('Highlights') },
    { pane: 'aiNotes', label: _('AI Notes') },
  ];

  return (
    <div className='assistant-header select-none touch-manipulation' dir='ltr'>
      <div className='relative flex h-11 items-center px-3'>
        <div className='pointer-events-none absolute inset-x-12 inset-y-0 z-0 flex items-center justify-center'>
          <h2 className='assistant-title truncate text-center text-base font-medium tracking-tight'>
            {_('Reading Assistant')}
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
      {/* Underline marks the active pane so it stays legible without color (e-ink). */}
      <div className='border-base-content/10 flex border-b px-2' role='tablist'>
        {tabs.map((tab) => {
          const selected = tab.pane === pane;
          return (
            <button
              key={tab.pane}
              type='button'
              role='tab'
              aria-selected={selected}
              onClick={() => onPaneChange(tab.pane)}
              className={clsx(
                '-mb-px min-w-0 flex-1 truncate border-b-2 px-1 pb-2 pt-1 text-[0.85em]',
                'transition-colors duration-150',
                selected
                  ? 'border-base-content text-base-content font-medium'
                  : 'text-base-content/55 hover:text-base-content/80 border-transparent',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AssistantHeader;
