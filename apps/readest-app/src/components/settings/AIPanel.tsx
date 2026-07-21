import clsx from 'clsx';
import React, { useCallback, useEffect, useId, useState } from 'react';
import { PiArrowsClockwise, PiCheckCircle, PiSpinner, PiWarningCircle } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import {
  DEFAULT_MODEL_CONFIG,
  getActiveProfile,
  mergeModelConfig,
  resetDeepSeekDefaults,
  toSidecarModelPayload,
  upsertActiveProfileFields,
  type ModelApiMode,
  type ModelConfig,
} from '@/services/wellread/modelConfig';
import { getModelApiKey, setModelApiKey } from '@/services/wellread/modelApiKey';
import { testModelConnection } from '@/services/wellread/testModelConnection';
import { reloadEveSidecar } from '@/services/wellread/eveSidecar';
import { useEveConnectionStore } from '@/services/wellread/eveConnectionStore';
import { SectionTitle, SettingLabel } from './primitives';
import { Toggle } from '@/components/primitives/toggle';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

const defaultProfile = getActiveProfile(DEFAULT_MODEL_CONFIG)!;

/** Shared chrome for AI form fields and the Enable AI row so widths/heights align. */
const fieldBoxClass = clsx(
  'eink-bordered settings-content',
  'border-base-200 bg-base-100 h-11 w-full rounded-lg border',
);

const fieldInputClass = clsx(
  fieldBoxClass,
  'input input-bordered !px-3 text-start',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
);

const fieldSelectClass = clsx(
  fieldBoxClass,
  'select select-bordered !px-3 text-start',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
);

const actionBtnClass =
  'active:scale-[0.96] transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)]';

const AIPanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const baseId = useId();

  const saved = mergeModelConfig(settings?.modelConfig);
  const savedProfile = getActiveProfile(saved) ?? defaultProfile;

  const [enabled, setEnabled] = useState(saved.enabled);
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState(savedProfile.modelId);
  const [baseURL, setBaseURL] = useState(savedProfile.baseURL);
  const [apiMode, setApiMode] = useState<ModelApiMode>(savedProfile.apiMode);
  const [contextWindowTokens, setContextWindowTokens] = useState(
    String(savedProfile.contextWindowTokens),
  );
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [connectionError, setConnectionError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getModelApiKey(savedProfile.id).then(setApiKey);
  }, [savedProfile.id]);

  const persist = useCallback(
    async (next: ModelConfig, nextApiKey: string) => {
      setSaving(true);
      try {
        const updated = { ...settings, modelConfig: next };
        setSettings(updated);
        await saveSettings(envConfig, updated);
        const active = getActiveProfile(next);
        if (active) {
          await setModelApiKey(active.id, nextApiKey);
          const payload = toSidecarModelPayload(next);
          if (payload) {
            await reloadEveSidecar({ ...payload, apiKey: nextApiKey });
          }
        }
        await useEveConnectionStore.getState().refresh();
      } finally {
        setSaving(false);
      }
    },
    [envConfig, saveSettings, setSettings, settings],
  );

  const buildConfig = (): ModelConfig =>
    upsertActiveProfileFields(
      { ...saved, enabled },
      {
        baseURL,
        modelId,
        contextWindowTokens: Number(contextWindowTokens),
        apiMode,
      },
    );

  const handleSave = async () => {
    await persist(buildConfig(), apiKey);
  };

  const handleResetDeepSeek = async () => {
    const reset = resetDeepSeekDefaults(buildConfig());
    const profile = getActiveProfile(reset) ?? defaultProfile;
    setBaseURL(profile.baseURL);
    setModelId(profile.modelId);
    setContextWindowTokens(String(profile.contextWindowTokens));
    setApiMode(profile.apiMode);
    await persist(reset, apiKey);
  };

  const handleTestConnection = async () => {
    setConnectionStatus('testing');
    setConnectionError('');
    const result = await testModelConnection({
      baseURL: baseURL.trim() || defaultProfile.baseURL,
      apiKey,
      modelId: modelId.trim() || defaultProfile.modelId,
    });
    if (result.ok) {
      setConnectionStatus('success');
    } else {
      setConnectionStatus('error');
      setConnectionError(result.error);
    }
  };

  return (
    <div className='my-4 w-full space-y-6 px-4'>
      <label
        className={clsx(fieldBoxClass, 'flex cursor-pointer items-center justify-between px-3')}
        data-setting-id='settings.ai.enableAssistant'
      >
        <SettingLabel>{_('Enable AI')}</SettingLabel>
        <Toggle checked={enabled} onChange={() => setEnabled(!enabled)} />
      </label>

      <div className='w-full space-y-4'>
        <SectionTitle className='!ps-0'>{_('Model')}</SectionTitle>

        <div className='space-y-1.5' data-setting-id='settings.ai.baseURL'>
          <SectionTitle as='label' htmlFor={`${baseId}-base-url`} className='!ps-0 block'>
            {_('Base URL')}
          </SectionTitle>
          <input
            id={`${baseId}-base-url`}
            type='url'
            inputMode='url'
            autoCapitalize='off'
            spellCheck={false}
            value={baseURL}
            placeholder={defaultProfile.baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            className={fieldInputClass}
          />
        </div>

        <div className='space-y-1.5' data-setting-id='settings.ai.apiKey'>
          <SectionTitle as='label' htmlFor={`${baseId}-api-key`} className='!ps-0 block'>
            {_('API Key')}
          </SectionTitle>
          <input
            id={`${baseId}-api-key`}
            type='password'
            autoComplete='off'
            spellCheck={false}
            value={apiKey}
            placeholder={_('Stored in OS keychain')}
            onChange={(e) => setApiKey(e.target.value)}
            className={fieldInputClass}
          />
        </div>

        <div className='space-y-1.5' data-setting-id='settings.ai.modelId'>
          <SectionTitle as='label' htmlFor={`${baseId}-model-id`} className='!ps-0 block'>
            {_('Model ID')}
          </SectionTitle>
          <input
            id={`${baseId}-model-id`}
            type='text'
            autoCapitalize='off'
            spellCheck={false}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className={fieldInputClass}
          />
        </div>

        <div className='space-y-1.5' data-setting-id='settings.ai.apiMode'>
          <SectionTitle as='label' htmlFor={`${baseId}-api-mode`} className='!ps-0 block'>
            {_('API Mode')}
          </SectionTitle>
          <select
            id={`${baseId}-api-mode`}
            value={apiMode}
            onChange={(e) => setApiMode(e.target.value === 'responses' ? 'responses' : 'chat')}
            className={fieldSelectClass}
          >
            <option value='chat'>{_('Chat Completions')}</option>
            <option value='responses'>{_('Responses API')}</option>
          </select>
        </div>

        <div className='space-y-1.5'>
          <SectionTitle as='label' htmlFor={`${baseId}-context-window`} className='!ps-0 block'>
            {_('Context Window Tokens')}
          </SectionTitle>
          <input
            id={`${baseId}-context-window`}
            type='number'
            min={1}
            inputMode='numeric'
            value={contextWindowTokens}
            onChange={(e) => setContextWindowTokens(e.target.value)}
            className={clsx(
              fieldInputClass,
              'tabular-nums',
              '[appearance:textfield]',
              '[&::-webkit-inner-spin-button]:appearance-none',
              '[&::-webkit-outer-spin-button]:appearance-none',
            )}
          />
        </div>
      </div>

      <div className='space-y-2'>
        {(connectionStatus === 'success' || connectionStatus === 'error') && (
          <div className='flex min-h-5 items-center'>
            {connectionStatus === 'success' && (
              <span className='text-success flex items-center gap-1 text-[0.85em]'>
                <PiCheckCircle className='h-4 w-4' />
                {_('Connected')}
              </span>
            )}
            {connectionStatus === 'error' && (
              <span className='text-error flex items-center gap-1 text-[0.85em]'>
                <PiWarningCircle className='h-4 w-4 shrink-0' />
                <span className='min-w-0'>{connectionError || _('Connection failed')}</span>
              </span>
            )}
          </div>
        )}
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <button
            type='button'
            className={clsx('btn btn-ghost btn-sm gap-1.5 ps-3 pe-2.5', actionBtnClass)}
            onClick={handleResetDeepSeek}
          >
            <PiArrowsClockwise className='h-4 w-4' />
            {_('Restore DeepSeek Defaults')}
          </button>
          <button
            type='button'
            className={clsx('btn btn-ghost btn-sm gap-1.5', actionBtnClass)}
            disabled={connectionStatus === 'testing'}
            onClick={handleTestConnection}
          >
            {connectionStatus === 'testing' ? <PiSpinner className='h-4 w-4 animate-spin' /> : null}
            {_('Test Connection')}
          </button>
          <button
            type='button'
            className={clsx('btn btn-contrast btn-sm gap-1.5', actionBtnClass)}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? <PiSpinner className='h-4 w-4 animate-spin' /> : null}
            {_('Save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIPanel;
