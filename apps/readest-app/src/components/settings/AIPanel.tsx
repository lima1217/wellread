import React, { useCallback, useState } from 'react';
import { RiCpuLine, RiPuzzleLine } from 'react-icons/ri';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import {
  getActiveProfile,
  mergeModelConfig,
  type ModelConfig,
} from '@/services/wellread/modelConfig';
import { reloadEveIfNeeded } from '@/services/wellread/assistant/reloadEveIfNeeded';
import BoxedList from './primitives/BoxedList';
import NavigationRow from './primitives/NavigationRow';
import SettingsSwitchRow from './primitives/SettingsSwitchRow';
import ModelProvidersPanel from './ModelProvidersPanel';
import ManageSkillsPanel from './ManageSkillsPanel';

type SubPage = 'providers' | 'skills' | null;

const AIPanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const [subPage, setSubPage] = useState<SubPage>(null);
  const [saving, setSaving] = useState(false);

  const saved = mergeModelConfig(settings?.modelConfig);
  const activeProfile = getActiveProfile(saved);
  const providerStatus = activeProfile
    ? `${activeProfile.name} · ${activeProfile.modelId}`
    : _('No profiles yet. Create one to configure a model.');
  const skillsStatus = saved.enabled ? undefined : _('Enable AI to manage skills');

  // Esc / Android Back are owned by the active sub-page (ModelProvidersPanel /
  // ManageSkillsPanel) so nested detail → list → AI steps correctly. Do not
  // register a second listener here or both levels would pop at once.

  const persist = useCallback(
    async (
      next: ModelConfig,
      options: {
        previousActiveId: string | null;
        previousEnabled?: boolean;
      },
    ) => {
      setSaving(true);
      try {
        const updated = { ...settings, modelConfig: next };
        setSettings(updated);
        await saveSettings(envConfig, updated);

        const enabledChanged =
          options.previousEnabled !== undefined && options.previousEnabled !== next.enabled;
        await reloadEveIfNeeded(next, {
          previousActiveId: options.previousActiveId,
          force: enabledChanged,
        });
      } finally {
        setSaving(false);
      }
    },
    [envConfig, saveSettings, setSettings, settings],
  );

  const handleToggleEnabled = async () => {
    if (saving) return;
    const next = { ...saved, enabled: !saved.enabled };
    await persist(next, {
      previousActiveId: saved.activeProfileId,
      previousEnabled: saved.enabled,
    });
  };

  if (subPage === 'providers') {
    return (
      <div className='w-full'>
        <ModelProvidersPanel onBack={() => setSubPage(null)} />
      </div>
    );
  }

  if (subPage === 'skills') {
    return (
      <div className='w-full'>
        <ManageSkillsPanel onBack={() => setSubPage(null)} />
      </div>
    );
  }

  return (
    <div className='my-4 w-full space-y-6'>
      <BoxedList data-setting-id='settings.ai.enableAssistant'>
        <SettingsSwitchRow
          label={_('Enable AI')}
          checked={saved.enabled}
          onChange={() => void handleToggleEnabled()}
          disabled={saving}
        />
      </BoxedList>

      <BoxedList
        title={_('LLM Providers')}
        data-setting-id='settings.ai.modelProviders'
        cardClassName='overflow-hidden'
      >
        <NavigationRow
          icon={RiCpuLine}
          title={_('Manage LLM Providers')}
          status={providerStatus}
          onClick={() => setSubPage('providers')}
        />
      </BoxedList>

      <BoxedList
        title={_('Skills')}
        data-setting-id='settings.ai.skills'
        cardClassName='overflow-hidden'
      >
        <NavigationRow
          icon={RiPuzzleLine}
          title={_('Manage Skills')}
          status={skillsStatus}
          onClick={() => setSubPage('skills')}
        />
      </BoxedList>
    </div>
  );
};

export default AIPanel;
