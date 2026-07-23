import clsx from 'clsx';
import React, { useCallback, useEffect, useId, useState } from 'react';
import { MdAdd, MdChevronRight } from 'react-icons/md';
import { PiCheckCircle, PiSpinner, PiWarningCircle } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import {
  DEFAULT_MODEL_CONFIG,
  addProfile,
  getActiveProfile,
  mergeModelConfig,
  removeProfile,
  setActiveProfile,
  shouldHotReloadEve,
  toSidecarModelPayload,
  updateProfile,
  type ModelApiMode,
  type ModelConfig,
  type ModelProfile,
} from '@/services/wellread/modelConfig';
import { clearModelApiKey, getModelApiKey, setModelApiKey } from '@/services/wellread/modelApiKey';
import { testModelConnection } from '@/services/wellread/testModelConnection';
import { reloadEveSidecar } from '@/services/wellread/eveSidecar';
import { useEveConnectionStore } from '@/services/wellread/eveConnectionStore';
import SubPageHeader from './SubPageHeader';
import { SectionTitle, SettingLabel } from './primitives';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

const defaultProfile = getActiveProfile(DEFAULT_MODEL_CONFIG)!;

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

const importBtnClass = clsx(
  'eink-bordered group flex h-11 w-full items-center justify-center gap-2.5',
  'border-base-200 bg-base-100 rounded-lg border px-4',
  'text-base-content text-sm font-medium',
  'transition-colors duration-150',
  'hover:border-base-300 hover:bg-base-300/40',
  'active:bg-base-200/80',
  'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'disabled:hover:border-base-200 disabled:hover:bg-base-100',
);

type DetailDraft = {
  name: string;
  apiKey: string;
  modelId: string;
  baseURL: string;
  apiMode: ModelApiMode;
  contextWindowTokens: string;
};

function draftFromProfile(profile: ModelProfile, apiKey: string): DetailDraft {
  return {
    name: profile.name,
    apiKey,
    modelId: profile.modelId,
    baseURL: profile.baseURL,
    apiMode: profile.apiMode,
    contextWindowTokens: String(profile.contextWindowTokens),
  };
}

interface ModelProvidersPanelProps {
  onBack: () => void;
}

const ModelProvidersPanel: React.FC<ModelProvidersPanelProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const baseId = useId();

  const saved = mergeModelConfig(settings?.modelConfig);

  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DetailDraft | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [connectionError, setConnectionError] = useState('');
  const [saving, setSaving] = useState(false);

  const editingProfile = editingProfileId
    ? (saved.profiles.find((p) => p.id === editingProfileId) ?? null)
    : null;

  useKeyDownActions({
    enabled: editingProfileId !== null,
    onCancel: () => {
      setEditingProfileId(null);
      setDraft(null);
      setConnectionStatus('idle');
      setConnectionError('');
    },
  });
  useKeyDownActions({
    enabled: editingProfileId === null,
    onCancel: onBack,
  });

  useEffect(() => {
    if (!editingProfileId) return;
    const profile = saved.profiles.find((p) => p.id === editingProfileId);
    if (!profile) {
      setEditingProfileId(null);
      setDraft(null);
      return;
    }
    let cancelled = false;
    void getModelApiKey(profile.id).then((apiKey) => {
      if (!cancelled) setDraft(draftFromProfile(profile, apiKey));
    });
    return () => {
      cancelled = true;
    };
    // Re-load draft when opening a profile; field edits stay local until Save.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: don't clobber draft on every save
  }, [editingProfileId]);

  const persist = useCallback(
    async (
      next: ModelConfig,
      options: {
        previousActiveId: string | null;
        editedProfileId: string | null;
        editedApiKey?: string;
      },
    ) => {
      setSaving(true);
      try {
        const updated = { ...settings, modelConfig: next };
        setSettings(updated);
        await saveSettings(envConfig, updated);

        if (options.editedProfileId && options.editedApiKey !== undefined) {
          await setModelApiKey(options.editedProfileId, options.editedApiKey);
        }

        const needsReload = shouldHotReloadEve({
          previousActiveId: options.previousActiveId,
          nextActiveId: next.activeProfileId,
          editedProfileId: options.editedProfileId,
        });

        if (needsReload) {
          const active = getActiveProfile(next);
          if (active) {
            const apiKey =
              options.editedProfileId === active.id && options.editedApiKey !== undefined
                ? options.editedApiKey
                : await getModelApiKey(active.id);
            const payload = toSidecarModelPayload(next);
            if (payload) {
              await reloadEveSidecar({ ...payload, apiKey });
            }
          } else {
            await reloadEveSidecar({ enabled: next.enabled });
          }
        }
        await useEveConnectionStore.getState().refresh();
      } finally {
        setSaving(false);
      }
    },
    [envConfig, saveSettings, setSettings, settings],
  );

  const handleNewProfile = async () => {
    const { config, profile } = addProfile(saved);
    await persist(config, {
      previousActiveId: saved.activeProfileId,
      editedProfileId: null,
    });
    setConnectionStatus('idle');
    setConnectionError('');
    setEditingProfileId(profile.id);
  };

  const handleSetActive = async (profileId: string) => {
    const next = setActiveProfile(saved, profileId);
    if (next === saved) return;
    await persist(next, {
      previousActiveId: saved.activeProfileId,
      editedProfileId: null,
    });
  };

  const handleDeleteProfile = async (profileId: string) => {
    const next = removeProfile(saved, profileId);
    await clearModelApiKey(profileId);
    if (editingProfileId === profileId) {
      setEditingProfileId(null);
      setDraft(null);
    }
    await persist(next, {
      previousActiveId: saved.activeProfileId,
      editedProfileId: null,
    });
  };

  const handleSaveDetail = async () => {
    if (!editingProfileId || !draft) return;
    const next = updateProfile(saved, editingProfileId, {
      name: draft.name,
      modelId: draft.modelId,
      baseURL: draft.baseURL,
      apiMode: draft.apiMode,
      contextWindowTokens: Number(draft.contextWindowTokens),
    });
    await persist(next, {
      previousActiveId: saved.activeProfileId,
      editedProfileId: editingProfileId,
      editedApiKey: draft.apiKey,
    });
  };

  const handleTestConnection = async () => {
    if (!draft) return;
    setConnectionStatus('testing');
    setConnectionError('');
    const result = await testModelConnection({
      baseURL: draft.baseURL.trim() || defaultProfile.baseURL,
      apiKey: draft.apiKey,
      modelId: draft.modelId.trim() || defaultProfile.modelId,
    });
    if (result.ok) {
      setConnectionStatus('success');
    } else {
      setConnectionStatus('error');
      setConnectionError(result.error);
    }
  };

  const openDetail = (profileId: string) => {
    setConnectionStatus('idle');
    setConnectionError('');
    setDraft(null);
    setEditingProfileId(profileId);
  };

  if (editingProfileId && editingProfile && draft) {
    const isActive = saved.activeProfileId === editingProfileId;
    return (
      <div className='my-4 w-full space-y-6'>
        <SubPageHeader
          parentLabel={_('LLM Providers')}
          currentLabel={draft.name.trim() || editingProfile.name}
          description={_('Edit this model profile. API keys stay in the OS keychain.')}
          onBack={() => {
            setEditingProfileId(null);
            setDraft(null);
          }}
        />

        <div className='space-y-4 px-4'>
          <div className='space-y-1.5' data-setting-id='settings.ai.profileName'>
            <SectionTitle as='label' htmlFor={`${baseId}-name`} className='!ps-0 block'>
              {_('Display Name')}
            </SectionTitle>
            <input
              id={`${baseId}-name`}
              type='text'
              spellCheck={false}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className={fieldInputClass}
            />
          </div>

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
              value={draft.baseURL}
              placeholder={defaultProfile.baseURL}
              onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })}
              className={fieldInputClass}
            />
          </div>

          <div className='space-y-1.5' data-setting-id='settings.ai.apiMode'>
            <SectionTitle as='label' htmlFor={`${baseId}-api-mode`} className='!ps-0 block'>
              {_('API Mode')}
            </SectionTitle>
            <select
              id={`${baseId}-api-mode`}
              value={draft.apiMode}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  apiMode: e.target.value === 'responses' ? 'responses' : 'chat',
                })
              }
              className={fieldSelectClass}
            >
              <option value='chat'>{_('Chat Completions')}</option>
              <option value='responses'>{_('Responses API')}</option>
            </select>
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
              value={draft.apiKey}
              placeholder={_('Stored in OS keychain')}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
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
              value={draft.modelId}
              onChange={(e) => setDraft({ ...draft, modelId: e.target.value })}
              className={fieldInputClass}
            />
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
              value={draft.contextWindowTokens}
              onChange={(e) => setDraft({ ...draft, contextWindowTokens: e.target.value })}
              className={clsx(
                fieldInputClass,
                'tabular-nums',
                '[appearance:textfield]',
                '[&::-webkit-inner-spin-button]:appearance-none',
                '[&::-webkit-outer-spin-button]:appearance-none',
              )}
            />
          </div>

          <div className='space-y-2'>
            {(connectionStatus === 'success' || connectionStatus === 'error') && (
              <div className='flex min-h-5 items-center justify-end'>
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
              {!isActive && (
                <button
                  type='button'
                  className={clsx('btn btn-ghost btn-sm', actionBtnClass)}
                  disabled={saving}
                  onClick={() => void handleSetActive(editingProfileId)}
                >
                  {_('Set Active')}
                </button>
              )}
              <button
                type='button'
                className={clsx('btn btn-ghost btn-sm', actionBtnClass)}
                disabled={connectionStatus === 'testing'}
                onClick={() => void handleTestConnection()}
              >
                {connectionStatus === 'testing' ? (
                  <PiSpinner className='h-4 w-4 animate-spin' />
                ) : null}
                {_('Test Connection')}
              </button>
              <button
                type='button'
                className={clsx('btn btn-ghost btn-sm text-error', actionBtnClass)}
                disabled={saving}
                onClick={() => void handleDeleteProfile(editingProfileId)}
              >
                {_('Delete')}
              </button>
              <button
                type='button'
                className={clsx('btn btn-contrast btn-sm gap-1.5', actionBtnClass)}
                disabled={saving}
                onClick={() => void handleSaveDetail()}
              >
                {saving ? <PiSpinner className='h-4 w-4 animate-spin' /> : null}
                {_('Save')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (editingProfileId && !draft) {
    return (
      <div className='my-4 flex w-full items-center justify-center px-4 py-12'>
        <PiSpinner className='text-base-content/50 h-5 w-5 animate-spin' />
      </div>
    );
  }

  return (
    <div className='my-4 w-full space-y-4'>
      <SubPageHeader
        parentLabel={_('AI')}
        currentLabel={_('LLM Providers')}
        description={_('Add and manage LLM provider profiles for the reading assistant.')}
        onBack={onBack}
      />

      <div className='px-4'>
        <div className='card border-base-200 bg-base-100 overflow-hidden border'>
          <div className='divide-base-200 divide-y'>
            {saved.profiles.length === 0 ? (
              <div className='text-base-content/60 px-4 py-6 text-center text-sm'>
                {_('No profiles yet. Create one to configure a model.')}
              </div>
            ) : (
              saved.profiles.map((profile) => {
                const isActive = saved.activeProfileId === profile.id;
                return (
                  <div
                    key={profile.id}
                    className='flex min-h-14 w-full items-center gap-2 px-3'
                    data-setting-id={`settings.ai.profile.${profile.id}`}
                  >
                    <button
                      type='button'
                      onClick={() => openDetail(profile.id)}
                      className={clsx(
                        'group flex min-h-14 min-w-0 flex-1 items-center gap-3 text-left',
                        'focus-visible:ring-base-content/15 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
                      )}
                    >
                      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                        <SettingLabel>{profile.name}</SettingLabel>
                        <span className='text-base-content/65 truncate text-[0.85em]'>
                          {profile.modelId}
                        </span>
                      </div>
                      {isActive && (
                        <span className='text-base-content/70 shrink-0 text-[0.75em] font-medium tracking-wide uppercase'>
                          {_('Active')}
                        </span>
                      )}
                      <MdChevronRight className='text-base-content/50 h-5 w-5 shrink-0' />
                    </button>
                    {!isActive && (
                      <button
                        type='button'
                        className={clsx('btn btn-ghost btn-xs shrink-0', actionBtnClass)}
                        disabled={saving}
                        onClick={() => void handleSetActive(profile.id)}
                      >
                        {_('Set Active')}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className='mt-4'>
          <button
            type='button'
            onClick={() => void handleNewProfile()}
            disabled={saving}
            className={importBtnClass}
          >
            <span
              className={clsx(
                'eink-inverted',
                'flex h-5 w-5 items-center justify-center rounded-full',
                'bg-base-200 text-base-content/60',
                'transition-colors duration-150',
                'group-hover:bg-base-content group-hover:text-base-100',
                'group-disabled:bg-base-200 group-disabled:text-base-content/60',
              )}
            >
              {saving ? (
                <PiSpinner className='h-3.5 w-3.5 animate-spin' />
              ) : (
                <MdAdd className='h-3.5 w-3.5' />
              )}
            </span>
            <span className='line-clamp-1'>{_('New Profile')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModelProvidersPanel;
