import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { saveViewSettings } from '@/helpers/settings';
import { useResetViewSettings } from '@/hooks/useResetSettings';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { TRANSLATED_LANGS } from '@/services/constants';
import { ConvertChineseVariant } from '@/types/book';
import { SettingsPanelPanelProp } from './SettingsDialog';
import { getDirFromLanguage } from '@/utils/rtl';
import { isCJKEnv } from '@/utils/misc';
import {
  BoxedList,
  NavigationRow,
  SettingsRow,
  SettingsSelect,
  SettingsSwitchRow,
} from './primitives';
import CustomDictionaries from './CustomDictionaries';
import WordLensPanel from './WordLensPanel';
import { PiTranslate } from 'react-icons/pi';

const LangPanel: React.FC<SettingsPanelPanelProp> = ({ bookKey, onRegisterReset }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, applyUILanguage, activeSettingsItemId, setActiveSettingsItemId } =
    useSettingsStore();
  const { getView, getViewSettings, recreateViewer } = useReaderStore();
  const view = getView(bookKey);
  const viewSettings = getViewSettings(bookKey) || settings.globalViewSettings;

  const [uiLanguage, setUILanguage] = useState(viewSettings.uiLanguage);
  const [replaceQuotationMarks, setReplaceQuotationMarks] = useState(
    viewSettings.replaceQuotationMarks,
  );
  const [convertChineseVariant, setConvertChineseVariant] = useState(
    viewSettings.convertChineseVariant,
  );
  const [showCustomDictionaries, setShowCustomDictionaries] = useState(false);
  const [showWordLens, setShowWordLens] = useState(false);

  // Android Back / Esc: when a sub-page is open, intercept and step back to the
  // language list instead of letting <Dialog>'s listener close the whole
  // Settings dialog. See the matching comment in FontPanel.tsx for the
  // LIFO-dispatch reasoning.
  useKeyDownActions({
    enabled: showCustomDictionaries,
    onCancel: () => setShowCustomDictionaries(false),
  });
  useKeyDownActions({
    enabled: showWordLens,
    onCancel: () => setShowWordLens(false),
  });

  // Deep-link: callers (e.g. the dictionary popup's manage icon) can set
  // activeSettingsItemId to `'settings.language.dictionaries.manage'` to
  // jump straight into the Manage Dictionaries sub-page on open. Clear the
  // id once consumed so SettingsDialog's scroll-to-element fallback
  // (which runs on a 100ms timeout) doesn't re-fire.
  useEffect(() => {
    if (activeSettingsItemId === 'settings.language.dictionaries.manage') {
      setShowCustomDictionaries(true);
      setActiveSettingsItemId(null);
    }
  }, [activeSettingsItemId, setActiveSettingsItemId]);

  const resetToDefaults = useResetViewSettings();

  const handleReset = () => {
    resetToDefaults({
      uiLanguage: setUILanguage,
      replaceQuotationMarks: setReplaceQuotationMarks,
    });
  };

  useEffect(() => {
    onRegisterReset(handleReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCurrentUILangOption = () => {
    const uiLanguage = viewSettings.uiLanguage;
    return {
      value: uiLanguage,
      label:
        uiLanguage === ''
          ? _('Auto')
          : TRANSLATED_LANGS[uiLanguage as keyof typeof TRANSLATED_LANGS],
    };
  };

  const getLangOptions = (langs: Record<string, string>) => {
    const options = Object.entries(langs).map(([value, label]) => ({ value, label }));
    options.sort((a, b) => a.label.localeCompare(b.label));
    options.unshift({ value: '', label: _('System Language') });
    return options;
  };

  const handleSelectUILang = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value;
    setUILanguage(option);
  };

  useEffect(() => {
    if (uiLanguage === viewSettings.uiLanguage) return;
    const sameDir = getDirFromLanguage(uiLanguage) === getDirFromLanguage(viewSettings.uiLanguage);
    applyUILanguage(uiLanguage);
    saveViewSettings(envConfig, bookKey, 'uiLanguage', uiLanguage, false, false).then(() => {
      if (!sameDir) window.location.reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiLanguage]);

  useEffect(() => {
    if (replaceQuotationMarks === viewSettings.replaceQuotationMarks) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'replaceQuotationMarks',
      replaceQuotationMarks,
      false,
      false,
    ).then(() => {
      recreateViewer(envConfig, bookKey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaceQuotationMarks]);

  const getConvertModeOptions: () => { value: ConvertChineseVariant; label: string }[] = () => {
    return [
      { value: 'none', label: _('No Conversion') },
      { value: 's2t', label: _('Simplified to Traditional') },
      { value: 't2s', label: _('Traditional to Simplified') },
      { value: 's2tw', label: _('Simplified to Traditional (Taiwan)') },
      { value: 's2hk', label: _('Simplified to Traditional (Hong Kong)') },
      { value: 's2twp', label: _('Simplified to Traditional (Taiwan), with phrases') },
      { value: 'tw2s', label: _('Traditional (Taiwan) to Simplified') },
      { value: 'hk2s', label: _('Traditional (Hong Kong) to Simplified') },
      { value: 'tw2sp', label: _('Traditional (Taiwan) to Simplified, with phrases') },
    ];
  };

  const getConvertModeOption = () => {
    const value = convertChineseVariant;
    const availableOptions = getConvertModeOptions();
    return availableOptions.find((o) => o.value === value) || availableOptions[0]!;
  };

  const handleSelectConvertMode = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const option = event.target.value as ConvertChineseVariant;
    setConvertChineseVariant(option);
  };

  useEffect(() => {
    if (convertChineseVariant === viewSettings.convertChineseVariant) return;
    saveViewSettings(
      envConfig,
      bookKey,
      'convertChineseVariant',
      convertChineseVariant,
      false,
      false,
    ).then(() => {
      recreateViewer(envConfig, bookKey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convertChineseVariant]);

  if (showCustomDictionaries) {
    return (
      <div className='my-4 w-full'>
        <CustomDictionaries onBack={() => setShowCustomDictionaries(false)} />
      </div>
    );
  }

  if (showWordLens) {
    return <WordLensPanel bookKey={bookKey} onBack={() => setShowWordLens(false)} />;
  }

  return (
    <div className={clsx('my-4 w-full space-y-6')}>
      <BoxedList title={_('Language')} data-setting-id='settings.language.interfaceLanguage'>
        <SettingsRow label={_('Language')}>
          <SettingsSelect
            value={getCurrentUILangOption().value}
            onChange={handleSelectUILang}
            ariaLabel={_('Language')}
            options={getLangOptions(TRANSLATED_LANGS)}
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList
        title={_('Dictionaries')}
        data-setting-id='settings.language.dictionaries'
        cardClassName='overflow-hidden'
      >
        <NavigationRow
          title={_('Manage Dictionaries')}
          onClick={() => setShowCustomDictionaries(true)}
          className='h-14'
        />
      </BoxedList>

      <BoxedList
        title={_('Word Lens')}
        data-setting-id='settings.language.wordlens'
        cardClassName='overflow-hidden'
      >
        <NavigationRow
          icon={PiTranslate}
          title={_('Word Lens')}
          status={_('Show a short native-language hint above difficult words.')}
          onClick={() => setShowWordLens(true)}
        />
      </BoxedList>

      {(isCJKEnv() || view?.language.isCJK) && (
        <BoxedList title={_('Punctuation')} data-setting-id='settings.language.quotationMarks'>
          <SettingsSwitchRow
            label={_('Replace Quotation Marks')}
            description={_('Enabled only in vertical layout.')}
            checked={replaceQuotationMarks}
            onChange={() => setReplaceQuotationMarks(!replaceQuotationMarks)}
          />
        </BoxedList>
      )}

      {(isCJKEnv() || view?.language.isCJK) && (
        <BoxedList
          title={_('Convert Simplified and Traditional Chinese')}
          data-setting-id='settings.language.chineseConversion'
        >
          <SettingsRow label={_('Convert Mode')}>
            <SettingsSelect
              value={getConvertModeOption().value}
              onChange={handleSelectConvertMode}
              ariaLabel={_('Convert Mode')}
              options={getConvertModeOptions()}
            />
          </SettingsRow>
        </BoxedList>
      )}
    </div>
  );
};

export default LangPanel;
