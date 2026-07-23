import clsx from 'clsx';
import React, { useCallback, useEffect, useState } from 'react';
import { MdAdd } from 'react-icons/md';
import { IoMdCloseCircleOutline } from 'react-icons/io';
import { PiSpinner } from 'react-icons/pi';

import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { listEveSkills, type EveSkillSummary } from '@/services/wellread/assistant/eveClient';
import {
  createAppServiceSkillImportFs,
  deleteSkillPackage,
  importSkillFromFolder,
} from '@/services/wellread/assistant/importSkill';
import { eventDispatcher } from '@/utils/event';
import SubPageHeader from './SubPageHeader';
import { SettingLabel } from './primitives';

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

interface ManageSkillsPanelProps {
  onBack: () => void;
}

const ManageSkillsPanel: React.FC<ManageSkillsPanelProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const [skills, setSkills] = useState<EveSkillSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  useKeyDownActions({
    enabled: true,
    onCancel: onBack,
  });

  const refreshSkills = useCallback(async () => {
    setLoaded(false);
    setLoadError(false);
    try {
      const rows = await listEveSkills();
      setSkills(rows);
      setLoadError(false);
    } catch {
      setSkills([]);
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  const handleImportSkill = async () => {
    if (!appService || busy) return;
    setBusy(true);
    try {
      const folder = await appService.selectDirectory('read');
      if (!folder) return;
      const result = await importSkillFromFolder(createAppServiceSkillImportFs(appService), folder);
      if (!result.ok) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Failed to import skill: {{message}}', { message: result.error }),
          timeout: 4000,
        });
        return;
      }
      await refreshSkills();
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: result.replaced
          ? _('Replaced skill {{id}}', { id: result.id })
          : _('Imported skill {{id}}', { id: result.id }),
        timeout: 2500,
      });
    } catch (error) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to import skill: {{message}}', {
          message: error instanceof Error ? error.message : String(error),
        }),
        timeout: 4000,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSkill = async (skillId: string) => {
    if (!appService || busy) return;
    const confirmed = window.confirm(
      _('Delete skill "{{id}}"? This cannot be undone.', { id: skillId }),
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await deleteSkillPackage(createAppServiceSkillImportFs(appService), skillId);
      if (!result.ok) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Failed to delete skill: {{message}}', { message: result.error }),
          timeout: 4000,
        });
        return;
      }
      await refreshSkills();
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Deleted skill {{id}}', { id: result.id }),
        timeout: 2500,
      });
    } catch (error) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to delete skill: {{message}}', {
          message: error instanceof Error ? error.message : String(error),
        }),
        timeout: 4000,
      });
    } finally {
      setBusy(false);
    }
  };

  const canImport = Boolean(appService?.selectDirectory);

  return (
    <div className='my-4 w-full space-y-4'>
      <SubPageHeader
        parentLabel={_('AI')}
        currentLabel={_('Skills')}
        description={_('Import and manage skill packages for the reading assistant.')}
        onBack={onBack}
      />

      <div className='px-4'>
        <div className='card border-base-200 bg-base-100 overflow-hidden border'>
          <div className='divide-base-200 divide-y'>
            {!loaded ? (
              <div className='flex items-center justify-center px-4 py-10'>
                <PiSpinner className='text-base-content/50 h-5 w-5 animate-spin' />
              </div>
            ) : loadError ? (
              <div className='text-base-content/60 px-4 py-6 text-center text-sm'>
                {_('Could not load skills. Enable AI and try again.')}
              </div>
            ) : skills.length === 0 ? (
              <div className='text-base-content/60 px-4 py-6 text-center text-sm'>
                {_('No skills installed yet.')}
              </div>
            ) : (
              skills.map((skill) => (
                <div
                  key={skill.id}
                  className='flex min-h-14 w-full items-center gap-2 px-3'
                  data-setting-id={`settings.ai.skill.${skill.id}`}
                >
                  <div className='flex min-w-0 flex-1 flex-col gap-0.5 py-3'>
                    <SettingLabel>{skill.name || skill.id}</SettingLabel>
                    <span className='text-base-content/65 line-clamp-2 text-[0.85em]'>
                      {skill.description || skill.id}
                    </span>
                  </div>
                  <button
                    type='button'
                    onClick={() => void handleDeleteSkill(skill.id)}
                    className='btn btn-ghost btn-sm shrink-0 px-1'
                    aria-label={_('Delete')}
                    title={_('Delete')}
                    disabled={busy}
                  >
                    <IoMdCloseCircleOutline className='text-base-content/75 h-5 w-5' />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {canImport && (
          <div className='mt-4'>
            <button
              type='button'
              onClick={() => void handleImportSkill()}
              disabled={busy}
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
                {busy ? (
                  <PiSpinner className='h-3.5 w-3.5 animate-spin' />
                ) : (
                  <MdAdd className='h-3.5 w-3.5' />
                )}
              </span>
              <span className='line-clamp-1'>{busy ? _('Importing…') : _('Import Skill')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ManageSkillsPanel;
