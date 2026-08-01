'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2Icon } from 'lucide-react';
import clsx from 'clsx';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { getModelApiKey } from '@/services/wellread/modelApiKey';
import { getActiveProfile, mergeModelConfig } from '@/services/wellread/modelConfig';
import { useEveConnectionStore } from '@/services/wellread/eveConnectionStore';
import { isReadingAssistantAvailable } from '@/services/wellread/assistant/gate';
import { assistantChatRemountKey } from '@/services/wellread/assistant/turnLifecycle';
import { focusRing } from './AssistantMarkdown';
import { ReadingAssistantChat } from './ReadingAssistantChat';

export interface AIAssistantProps {
  bookKey: string;
  /** False while History pane covers chat (chat stays mounted). */
  isActive?: boolean;
}

const AIAssistant = ({ bookKey, isActive = true }: AIAssistantProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings, setSettingsDialogBookKey, setSettingsDialogOpen, setActiveSettingsItemId } =
    useSettingsStore();
  const { getBookData } = useBookDataStore();
  const bookData = getBookData(bookKey);
  const ready = useEveConnectionStore((s) => s.ready);
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

  const openAISettings = useCallback(() => {
    setSettingsDialogBookKey(bookKey);
    setActiveSettingsItemId('settings.ai.enableAssistant');
    setSettingsDialogOpen(true);
  }, [bookKey, setActiveSettingsItemId, setSettingsDialogBookKey, setSettingsDialogOpen]);

  if (!available) {
    return (
      <div className='text-base-content/70 flex h-full flex-col items-center justify-center gap-3 p-4 text-center leading-relaxed'>
        {!ready ? (
          <Loader2Icon
            className='animate-spin select-none motion-reduce:animate-none'
            size={20}
            aria-hidden='true'
          />
        ) : null}
        <p className='select-text text-pretty' aria-live='polite'>
          {ready
            ? _('Enable Reading Assistant in Settings and add an API key.')
            : _('Starting the local Reading Assistant…')}
        </p>
        {ready ? (
          <button
            type='button'
            className={clsx(
              'btn btn-contrast h-9 min-h-0 rounded-lg px-4 text-sm font-medium',
              focusRing,
            )}
            onClick={openAISettings}
          >
            {_('Open AI settings')}
          </button>
        ) : null}
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

  return (
    <ReadingAssistantChat
      key={assistantChatRemountKey(bookId)}
      bookKey={bookKey}
      bookId={bookId}
      bookTitle={bookTitle}
      isActive={isActive}
    />
  );
};

export default AIAssistant;
