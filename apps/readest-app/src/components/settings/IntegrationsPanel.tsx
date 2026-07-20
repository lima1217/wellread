import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { MdChevronRight } from 'react-icons/md';
import { RiRssLine, RiBookReadLine, RiBook3Line, RiDiscordLine } from 'react-icons/ri';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomOPDSStore } from '@/store/customOPDSStore';
import { CatalogManager } from '@/app/opds/components/CatalogManager';
import { saveSysSettings } from '@/helpers/settings';
import ReadwiseForm from './integrations/ReadwiseForm';
import HardcoverForm from './integrations/HardcoverForm';
import SubPageHeader from './SubPageHeader';
import { SectionTitle, SettingLabel } from './primitives';

type SubPage = 'readwise' | 'hardcover' | 'opds' | null;

const IntegrationsPanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, requestedSubPage, setRequestedSubPage } = useSettingsStore();
  const opdsCatalogs = useCustomOPDSStore((s) => s.catalogs);
  const opdsCount = opdsCatalogs.filter((c) => !c.deletedAt).length;
  const [subPage, setSubPage] = useState<SubPage>(null);

  useKeyDownActions({
    enabled: subPage !== null,
    onCancel: () => setSubPage(null),
  });

  const toggleDiscordPresence = () => {
    const discordRichPresenceEnabled = !settings.discordRichPresenceEnabled;
    saveSysSettings(envConfig, 'discordRichPresenceEnabled', discordRichPresenceEnabled);
  };

  useEffect(() => {
    if (!requestedSubPage) return;
    if (
      requestedSubPage === 'readwise' ||
      requestedSubPage === 'hardcover' ||
      requestedSubPage === 'opds'
    ) {
      setSubPage(requestedSubPage);
    }
    setRequestedSubPage(null);
  }, [requestedSubPage, setRequestedSubPage]);

  if (subPage === 'readwise')
    return (
      <div className='my-4 w-full'>
        <ReadwiseForm onBack={() => setSubPage(null)} />
      </div>
    );
  if (subPage === 'hardcover')
    return (
      <div className='my-4 w-full'>
        <HardcoverForm onBack={() => setSubPage(null)} />
      </div>
    );
  if (subPage === 'opds')
    return (
      <div className='my-4 w-full'>
        <SubPageHeader
          parentLabel={_('Integrations')}
          currentLabel={_('OPDS Catalogs')}
          description={_('Browse and download books from online catalogs.')}
          onBack={() => setSubPage(null)}
        />
        <CatalogManager inSubPage />
      </div>
    );

  const readwiseStatus = settings.readwise?.enabled ? _('Connected') : _('Not connected');
  const hardcoverStatus = settings.hardcover?.enabled ? _('Connected') : _('Not connected');
  const opdsStatus =
    opdsCount > 0 ? _('{{count}} catalog', { count: opdsCount }) : _('No catalogs');

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full px-4'>
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Integrations')}</h2>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          {_('Connect Readest to external services for highlights and catalogs.')}
        </p>
      </div>

      <div className='w-full' data-setting-id='settings.integrations.sync'>
        <SectionTitle className='mb-2'>{_('Reading Sync')}</SectionTitle>
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
          <div className='divide-base-200 divide-y'>
            <IntegrationRow
              icon={RiBookReadLine}
              title={_('Readwise')}
              status={readwiseStatus}
              onClick={() => setSubPage('readwise')}
            />
            <IntegrationRow
              icon={RiBook3Line}
              title={_('Hardcover')}
              status={hardcoverStatus}
              onClick={() => setSubPage('hardcover')}
            />
          </div>
        </div>
      </div>

      <div className='w-full' data-setting-id='settings.integrations.catalogs'>
        <SectionTitle className='mb-2'>{_('Content Sources')}</SectionTitle>
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
          <div className='divide-base-200 divide-y'>
            <IntegrationRow
              icon={RiRssLine}
              title={_('OPDS Catalogs')}
              status={opdsStatus}
              onClick={() => setSubPage('opds')}
            />
          </div>
        </div>
      </div>

      {appService?.isDesktopApp && (
        <div className='w-full' data-setting-id='settings.integrations.discord'>
          <SectionTitle className='mb-2'>{_('Discord')}</SectionTitle>
          <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
            <div className='divide-base-200 divide-y'>
              <IntegrationToggleRow
                icon={RiDiscordLine}
                title={_('Show on Discord')}
                description={_("Display what I'm reading on Discord")}
                checked={settings.discordRichPresenceEnabled}
                onChange={toggleDiscordPresence}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface IntegrationRowProps {
  icon: React.ElementType;
  title: string;
  status: string;
  onClick: () => void;
}

const IntegrationRow: React.FC<IntegrationRowProps> = ({ icon: Icon, title, status, onClick }) => {
  return (
    <button
      type='button'
      onClick={onClick}
      className={clsx(
        'group flex w-full items-center gap-3 px-4 py-3 text-left',
        'transition-colors duration-150',
        'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
      )}
    >
      <span
        className={clsx(
          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full',
          'bg-base-200 text-base-content/70',
          'transition-colors duration-150',
          'group-hover:bg-base-300/70',
        )}
      >
        <Icon className='h-5 w-5' />
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <SettingLabel>{title}</SettingLabel>
        <span className='text-base-content/65 truncate text-[0.85em]'>{status}</span>
      </div>
      <MdChevronRight className='text-base-content/50 h-5 w-5 flex-shrink-0' />
    </button>
  );
};

interface IntegrationToggleRowProps {
  icon: React.ElementType;
  title: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}

const IntegrationToggleRow: React.FC<IntegrationToggleRowProps> = ({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
}) => {
  return (
    <label className='flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left'>
      <span
        className={clsx(
          'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full',
          'bg-base-200 text-base-content/70',
        )}
      >
        <Icon className='h-5 w-5' />
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <SettingLabel>{title}</SettingLabel>
        <span className='text-base-content/65 truncate text-[0.85em]'>{description}</span>
      </div>
      <input
        type='checkbox'
        className='toggle flex-shrink-0'
        checked={checked}
        onChange={onChange}
      />
    </label>
  );
};

export default IntegrationsPanel;
