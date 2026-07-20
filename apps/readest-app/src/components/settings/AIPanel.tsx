import React, { useCallback, useEffect, useState } from 'react';
import { PiArrowsClockwise, PiCheckCircle, PiSpinner, PiWarningCircle } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import {
  DEFAULT_MODEL_CONFIG,
  mergeModelConfig,
  resetDeepSeekDefaults,
  type ModelConfig,
} from '@/services/wellread/modelConfig';
import { getModelApiKey, setModelApiKey } from '@/services/wellread/modelApiKey';
import { testModelConnection } from '@/services/wellread/testModelConnection';
import { reloadEveSidecar } from '@/services/wellread/eveSidecar';
import { useEveConnectionStore } from '@/services/wellread/eveConnectionStore';
import { BoxedList, SettingsInput, SettingsRow, SettingsSwitchRow } from './primitives';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

const AIPanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const saved = mergeModelConfig(settings?.modelConfig);

  const [enabled, setEnabled] = useState(saved.enabled);
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState(saved.modelId);
  const [baseURL, setBaseURL] = useState(saved.baseURL);
  const [contextWindowTokens, setContextWindowTokens] = useState(String(saved.contextWindowTokens));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [connectionError, setConnectionError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getModelApiKey().then(setApiKey);
  }, []);

  const persist = useCallback(
    async (next: ModelConfig, nextApiKey: string) => {
      setSaving(true);
      try {
        const updated = { ...settings, modelConfig: next };
        setSettings(updated);
        await saveSettings(envConfig, updated);
        await setModelApiKey(nextApiKey);
        await reloadEveSidecar({ ...next, apiKey: nextApiKey });
        await useEveConnectionStore.getState().refresh();
      } finally {
        setSaving(false);
      }
    },
    [envConfig, saveSettings, setSettings, settings],
  );

  const buildConfig = (): ModelConfig =>
    mergeModelConfig({
      enabled,
      baseURL,
      modelId,
      contextWindowTokens: Number(contextWindowTokens),
    });

  const handleSave = async () => {
    await persist(buildConfig(), apiKey);
  };

  const handleResetDeepSeek = async () => {
    const reset = resetDeepSeekDefaults(buildConfig());
    setBaseURL(reset.baseURL);
    setModelId(reset.modelId);
    setContextWindowTokens(String(reset.contextWindowTokens));
    await persist(reset, apiKey);
  };

  const handleTestConnection = async () => {
    setConnectionStatus('testing');
    setConnectionError('');
    const result = await testModelConnection({
      baseURL: baseURL.trim() || DEFAULT_MODEL_CONFIG.baseURL,
      apiKey,
      modelId: modelId.trim() || DEFAULT_MODEL_CONFIG.modelId,
    });
    if (result.ok) {
      setConnectionStatus('success');
    } else {
      setConnectionStatus('error');
      setConnectionError(result.error);
    }
  };

  return (
    <div className='flex flex-col gap-4'>
      <BoxedList>
        <SettingsSwitchRow
          label={_('Enable Reading Assistant')}
          checked={enabled}
          onChange={() => setEnabled(!enabled)}
        />
      </BoxedList>

      <BoxedList>
        <SettingsRow label={_('API Key')}>
          <SettingsInput
            type='password'
            autoComplete='off'
            value={apiKey}
            placeholder={_('Stored in OS keychain')}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </SettingsRow>
        <SettingsRow label={_('Model ID')}>
          <SettingsInput type='text' value={modelId} onChange={(e) => setModelId(e.target.value)} />
        </SettingsRow>
      </BoxedList>

      <button
        type='button'
        className='btn btn-ghost btn-sm self-start'
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? _('Hide Advanced') : _('Advanced')}
      </button>

      {showAdvanced && (
        <BoxedList>
          <SettingsRow label={_('Base URL')}>
            <SettingsInput
              type='text'
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
            />
          </SettingsRow>
          <SettingsRow label={_('Context Window Tokens')}>
            <SettingsInput
              type='number'
              min={1}
              value={contextWindowTokens}
              onChange={(e) => setContextWindowTokens(e.target.value)}
            />
          </SettingsRow>
        </BoxedList>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <button
          type='button'
          className='btn btn-contrast btn-sm'
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? <PiSpinner className='animate-spin' /> : null}
          {_('Save')}
        </button>
        <button type='button' className='btn btn-ghost btn-sm' onClick={handleResetDeepSeek}>
          <PiArrowsClockwise />
          {_('Restore DeepSeek Defaults')}
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-sm'
          disabled={connectionStatus === 'testing'}
          onClick={handleTestConnection}
        >
          {connectionStatus === 'testing' ? <PiSpinner className='animate-spin' /> : null}
          {_('Test Connection')}
        </button>
        {connectionStatus === 'success' && (
          <span className='text-success flex items-center gap-1 text-sm'>
            <PiCheckCircle />
            {_('Connected')}
          </span>
        )}
        {connectionStatus === 'error' && (
          <span className='text-error flex items-center gap-1 text-sm'>
            <PiWarningCircle />
            {connectionError || _('Connection failed')}
          </span>
        )}
      </div>
    </div>
  );
};

export default AIPanel;
