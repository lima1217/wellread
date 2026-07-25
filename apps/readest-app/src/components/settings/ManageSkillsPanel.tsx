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
  hideBundledSkill,
  importSkillFromFolder,
  unhideBundledSkill,
} from '@/services/wellread/assistant/importSkill';
import { eventDispatcher } from '@/utils/event';
import SubPageHeader from './SubPageHeader';
import SettingLabel from './primitives/SettingLabel';

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

/**
 * If the sidecar is stale and ignores includeDisabled, a just-hidden bundled
 * skill vanishes from the API response. Keep prior bundled rows as disabled.
 */
function mergeManagementSkillRows(
  fresh: EveSkillSummary[],
  prev: EveSkillSummary[],
): EveSkillSummary[] {
  const byId = new Map(fresh.map((s) => [s.id, { ...s, enabled: s.enabled !== false }]));
  for (const old of prev) {
    if (old.source !== 'bundled') continue;
    if (byId.has(old.id)) continue;
    byId.set(old.id, { ...old, enabled: false });
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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

  const refreshSkills = useCallback(async (opts?: { soft?: boolean }) => {
    if (!opts?.soft) {
      setLoaded(false);
      setLoadError(false);
    }
    try {
      // Management list keeps hidden built-ins visible so toggles can restore them.
      const rows = await listEveSkills({ includeDisabled: true });
      setSkills((prev) => mergeManagementSkillRows(rows, prev));
      setLoadError(false);
    } catch {
      if (!opts?.soft) {
        setSkills([]);
        setLoadError(true);
      }
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
      await refreshSkills({ soft: true });
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

  const handleToggleBundled = async (skill: EveSkillSummary, nextEnabled: boolean) => {
    if (!appService || busy || skill.source !== 'bundled') return;
    setBusy(true);
    // Keep the row visible immediately — a stale sidecar without includeDisabled
    // would otherwise drop the skill from the list and look like a delete.
    setSkills((prev) => prev.map((s) => (s.id === skill.id ? { ...s, enabled: nextEnabled } : s)));
    try {
      const fs = createAppServiceSkillImportFs(appService);
      const result = nextEnabled
        ? await unhideBundledSkill(fs, skill.id)
        : await hideBundledSkill(fs, skill.id);
      if (!result.ok) {
        setSkills((prev) =>
          prev.map((s) => (s.id === skill.id ? { ...s, enabled: !nextEnabled } : s)),
        );
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: nextEnabled
            ? _('Failed to enable skill: {{message}}', { message: result.error })
            : _('Failed to hide skill: {{message}}', { message: result.error }),
          timeout: 4000,
        });
        return;
      }
      await refreshSkills({ soft: true });
    } catch (error) {
      setSkills((prev) =>
        prev.map((s) => (s.id === skill.id ? { ...s, enabled: !nextEnabled } : s)),
      );
      const message = error instanceof Error ? error.message : String(error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: nextEnabled
          ? _('Failed to enable skill: {{message}}', { message })
          : _('Failed to hide skill: {{message}}', { message }),
        timeout: 4000,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSkill = async (skill: EveSkillSummary) => {
    if (!appService || busy || skill.source !== 'user') return;
    if (
      !(await appService.ask(_('Delete skill "{{id}}"? This cannot be undone.', { id: skill.id })))
    ) {
      return;
    }
    setBusy(true);
    try {
      const result = await deleteSkillPackage(createAppServiceSkillImportFs(appService), skill.id);
      if (!result.ok) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Failed to delete skill: {{message}}', { message: result.error }),
          timeout: 4000,
        });
        return;
      }
      await refreshSkills({ soft: true });
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
                {_('No skills available.')}
              </div>
            ) : (
              skills.map((skill) => {
                const isBundled = skill.source === 'bundled';
                const enabled = skill.enabled !== false;
                return (
                  <div
                    key={skill.id}
                    className='flex min-h-14 w-full items-center gap-2 px-3'
                    data-setting-id={`settings.ai.skill.${skill.id}`}
                  >
                    <div className='flex min-w-0 flex-1 flex-col gap-0.5 py-3'>
                      <SettingLabel className={clsx(!enabled && 'text-base-content/60')}>
                        {skill.name || skill.id}
                      </SettingLabel>
                      <span className='text-base-content/65 line-clamp-2 text-[0.85em]'>
                        {skill.description || skill.id}
                      </span>
                    </div>
                    {isBundled ? (
                      <>
                        <span className='badge badge-sm badge-ghost shrink-0'>{_('Built-in')}</span>
                        <input
                          type='checkbox'
                          className='toggle toggle-sm shrink-0'
                          checked={enabled}
                          onChange={() => void handleToggleBundled(skill, !enabled)}
                          disabled={busy}
                          aria-label={enabled ? _('Disable') : _('Enable')}
                        />
                      </>
                    ) : (
                      <button
                        type='button'
                        onClick={() => void handleDeleteSkill(skill)}
                        className='btn btn-ghost btn-sm shrink-0 px-1'
                        aria-label={_('Delete')}
                        title={_('Delete')}
                        disabled={busy}
                      >
                        <IoMdCloseCircleOutline className='text-base-content/75 h-5 w-5' />
                      </button>
                    )}
                  </div>
                );
              })
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
