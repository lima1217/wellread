import clsx from 'clsx';
import React, { useCallback, useEffect, useState } from 'react';
import { useMediaQuery } from 'react-responsive';

import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useAssistantPanelStore } from '@/store/assistantPanelStore';
import { useReadingAssistantStore } from '@/services/wellread/assistant/readingAssistantStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useThemeStore } from '@/store/themeStore';
import { useEnv } from '@/context/EnvContext';
import { useSwipeToDismiss } from '@/hooks/useSwipeToDismiss';
import { usePanelResize } from '@/hooks/usePanelResize';
import { eventDispatcher } from '@/utils/event';
import { getBookDirFromLanguage } from '@/utils/book';
import { getPanelTopInset } from '@/utils/insets';
import { Overlay } from '@/components/Overlay';
import { saveSysSettings } from '@/helpers/settings';
import useShortcuts from '@/hooks/useShortcuts';
import AIAssistant from './AIAssistant';
import AssistantHeader from './Header';
import ChatHistoryView from '../sidebar/ChatHistoryView';

const MIN_ASSISTANT_PANEL_WIDTH = 0.15;
const MAX_ASSISTANT_PANEL_WIDTH = 0.45;

type AssistantPane = 'chat' | 'history';

const AssistantPanel: React.FC = ({}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { updateAppTheme, safeAreaInsets, systemUIVisible, statusBarHeight } = useThemeStore();
  const { sideBarBookKey } = useSidebarStore();
  const { assistantPanelWidth, isAssistantPanelVisible, isAssistantPanelPinned } =
    useAssistantPanelStore();
  const { setAssistantPanelPin } = useAssistantPanelStore();
  const { getBookData } = useBookDataStore();
  const { getViewSettings } = useReaderStore();
  const {
    getAssistantPanelWidth,
    setAssistantPanelWidth,
    setAssistantPanelVisible,
    toggleAssistantPanelPin,
  } = useAssistantPanelStore();
  const setActiveSession = useReadingAssistantStore((s) => s.setActiveSession);
  const clearPendingQuotes = useReadingAssistantStore((s) => s.clearPendingQuotes);

  const isMobile = useMediaQuery({ maxWidth: 639 });
  const [isFullHeightInMobile, setIsFullHeightInMobile] = useState(isMobile);
  const [pane, setPane] = useState<AssistantPane>('chat');
  // Keep chat mounted after the first open so closing the panel cannot abort an
  // in-flight turn (unmount → HTTP cancel → sidecar dropUser → "history lost").
  const [keepMounted, setKeepMounted] = useState(false);

  useEffect(() => {
    setPane('chat');
    setKeepMounted(false);
  }, [sideBarBookKey]);

  useEffect(() => {
    if (isAssistantPanelVisible) setKeepMounted(true);
  }, [isAssistantPanelVisible]);

  useEffect(() => {
    if (isAssistantPanelVisible) setPane('chat');
  }, [isAssistantPanelVisible]);

  const {
    panelRef: assistantPanelRef,
    overlayRef,
    panelHeight: assistantPanelHeight,
    handleVerticalDragStart,
  } = useSwipeToDismiss(
    () => {
      setAssistantPanelVisible(false);
      setIsFullHeightInMobile(isMobile);
    },
    (data) => setIsFullHeightInMobile(data.clientY < 44),
  );

  const onNavigateEvent = async () => {
    const { isAssistantPanelPinned } = useAssistantPanelStore.getState();
    if (!isAssistantPanelPinned) {
      setAssistantPanelVisible(false);
    }
  };

  const handleHideAssistantPanel = useCallback(() => {
    if (!isAssistantPanelPinned) {
      setAssistantPanelVisible(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAssistantPanelPinned]);

  useShortcuts({ onEscape: handleHideAssistantPanel }, [handleHideAssistantPanel]);

  useEffect(() => {
    if (isAssistantPanelVisible) {
      updateAppTheme('base-200');
      overlayRef.current = document.querySelector('.overlay') as HTMLDivElement | null;
    } else {
      updateAppTheme('base-100');
      overlayRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAssistantPanelVisible]);

  useEffect(() => {
    setAssistantPanelWidth(settings.globalReadSettings.assistantPanelWidth);
    setAssistantPanelPin(settings.globalReadSettings.isAssistantPanelPinned);
    setAssistantPanelVisible(settings.globalReadSettings.isAssistantPanelPinned);

    eventDispatcher.on('navigate', onNavigateEvent);
    return () => {
      eventDispatcher.off('navigate', onNavigateEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAssistantPanelResize = (newWidth: string) => {
    setAssistantPanelWidth(newWidth);
    settings.globalReadSettings.assistantPanelWidth = newWidth;
  };

  const handleTogglePin = () => {
    toggleAssistantPanelPin();
    const globalReadSettings = settings.globalReadSettings;
    const newGlobalReadSettings = {
      ...globalReadSettings,
      isAssistantPanelPinned: !isAssistantPanelPinned,
    };
    saveSysSettings(envConfig, 'globalReadSettings', newGlobalReadSettings);
  };

  const handleNewSession = useCallback(() => {
    if (!sideBarBookKey) return;
    const data = getBookData(sideBarBookKey);
    const bookId = data?.book?.hash || sideBarBookKey.split('-')[0] || '';
    if (!bookId) return;
    // Lazy create on first send (see turnLifecycle.ts). Empty POST orphans History rows.
    clearPendingQuotes();
    setActiveSession(null, bookId);
    setPane('chat');
  }, [sideBarBookKey, getBookData, clearPendingQuotes, setActiveSession]);

  const handleClickOverlay = () => {
    setAssistantPanelVisible(false);
  };

  const { handleResizeStart: handleDragStart, handleResizeKeyDown: handleDragKeyDown } =
    usePanelResize({
      side: 'end',
      minWidth: MIN_ASSISTANT_PANEL_WIDTH,
      maxWidth: MAX_ASSISTANT_PANEL_WIDTH,
      getWidth: getAssistantPanelWidth,
      onResize: handleAssistantPanelResize,
    });

  if (!sideBarBookKey) return null;

  const bookData = getBookData(sideBarBookKey);
  const viewSettings = getViewSettings(sideBarBookKey);
  if (!bookData || !bookData.bookDoc) {
    return null;
  }
  const { bookDoc } = bookData;
  const languageDir = getBookDirFromLanguage(bookDoc.metadata.language);

  if (!keepMounted && !isAssistantPanelVisible) return null;

  return (
    <>
      {isAssistantPanelVisible && !isAssistantPanelPinned && (
        <Overlay
          className={clsx('z-[45]', viewSettings?.isEink ? '' : 'bg-black/50 sm:bg-black/20')}
          onDismiss={handleClickOverlay}
        />
      )}
      <div
        ref={assistantPanelRef}
        className={clsx(
          'assistant-panel-container right-0 flex min-w-60 select-none flex-col overscroll-contain',
          'full-height font-sans text-base font-normal transition-[padding-top] duration-300',
          'motion-reduce:transition-none',
          viewSettings?.isEink ? 'bg-base-100' : 'bg-base-200',
          appService?.hasRoundedWindow && 'rounded-window-top-right rounded-window-bottom-right',
          isAssistantPanelPinned ? 'z-20' : 'z-[45] shadow-2xl',
          !isAssistantPanelPinned && viewSettings?.isEink && 'border-base-content border-s',
          !isAssistantPanelVisible && 'hidden',
        )}
        role='group'
        aria-label={_('Reading Assistant')}
        aria-hidden={!isAssistantPanelVisible}
        inert={!isAssistantPanelVisible ? true : undefined}
        dir={viewSettings?.rtl && languageDir === 'rtl' ? 'rtl' : 'ltr'}
        style={{
          width: isMobile ? '100%' : `${assistantPanelWidth}`,
          maxWidth: isMobile ? '100%' : `${MAX_ASSISTANT_PANEL_WIDTH * 100}%`,
          position: isMobile ? 'fixed' : isAssistantPanelPinned ? 'relative' : 'absolute',
          paddingTop: `${getPanelTopInset({
            isMobile,
            isFullHeightInMobile,
            systemUIVisible,
            statusBarHeight,
            safeAreaInsets,
          })}px`,
        }}
      >
        <style jsx>{`
          @media (max-width: 640px) {
            .assistant-panel-container {
              border-top-left-radius: 16px;
              border-top-right-radius: 16px;
            }
            .overlay {
              transition: opacity 0.3s ease-in-out;
            }
          }
        `}</style>
        <div
          className={clsx(
            'drag-bar absolute -left-2 top-0 h-full w-0.5 cursor-col-resize bg-transparent p-2',
            isMobile && 'hidden',
          )}
          role='slider'
          tabIndex={0}
          aria-label={_('Resize AI')}
          aria-orientation='horizontal'
          aria-valuemin={MIN_ASSISTANT_PANEL_WIDTH * 100}
          aria-valuemax={MAX_ASSISTANT_PANEL_WIDTH * 100}
          aria-valuenow={parseFloat(assistantPanelWidth)}
          aria-valuetext={`${Math.round(parseFloat(assistantPanelWidth))}%`}
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
          onKeyDown={handleDragKeyDown}
        />
        <div className='flex-shrink-0'>
          {isMobile && (
            <div
              role='slider'
              tabIndex={0}
              aria-label={_('Resize AI')}
              aria-orientation='vertical'
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={assistantPanelHeight.current}
              className='drag-handle flex h-6 max-h-6 min-h-6 w-full cursor-row-resize items-center justify-center'
              onMouseDown={handleVerticalDragStart}
              onTouchStart={handleVerticalDragStart}
            >
              <div className='bg-base-content/50 h-1 w-10 rounded-full'></div>
            </div>
          )}
          <AssistantHeader
            isPinned={isAssistantPanelPinned}
            pane={pane}
            handleClose={() => setAssistantPanelVisible(false)}
            handleTogglePin={handleTogglePin}
            onOpenHistory={() => setPane('history')}
            onBackToChat={() => setPane('chat')}
            onNewSession={handleNewSession}
          />
        </div>
        <div className='flex min-h-0 flex-1 flex-col'>
          {/* Keep chat mounted while history is open so in-flight streaming
              (useEveAgent React state) survives pane switches. */}
          <div
            className={clsx('flex min-h-0 flex-1 flex-col', pane !== 'chat' && 'hidden')}
            aria-hidden={pane !== 'chat'}
          >
            {/* Do not key on activeSessionId: first send creates a session and
                syncs it to the store; remounting here would destroy useEveAgent
                mid-stream. History / new-chat switches load via sessionId prop. */}
            <AIAssistant bookKey={sideBarBookKey} isActive={pane === 'chat'} />
          </div>
          {pane === 'history' && (
            <ChatHistoryView bookKey={sideBarBookKey} onSessionOpen={() => setPane('chat')} />
          )}
        </div>
        <div
          className='flex-shrink-0'
          style={{
            paddingBottom: `${(safeAreaInsets?.bottom || 0) / 2}px`,
          }}
        />
      </div>
    </>
  );
};

export default AssistantPanel;
