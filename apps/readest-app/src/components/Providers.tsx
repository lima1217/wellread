'use client';

import '@/utils/polyfill';
import i18n from '@/i18n/i18n';
import { useEffect } from 'react';
import { IconContext } from 'react-icons';
import { useEnv } from '@/context/EnvContext';
import { initSystemThemeListener, loadDataTheme } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomTextureStore } from '@/store/customTextureStore';
import { useSafeAreaInsets } from '@/hooks/useSafeAreaInsets';
import { installViewTransitionAbortGuard } from '@/utils/viewTransition';
import { useSettingsSync } from '@/hooks/useSettingsSync';
import { useDefaultIconSize } from '@/hooks/useResponsiveSize';
import { useBackgroundTexture } from '@/hooks/useBackgroundTexture';
import { useEinkMode } from '@/hooks/useEinkMode';
import { getLocale } from '@/utils/misc';
import { getDirFromUILanguage } from '@/utils/rtl';
import { getAndroidPatchedViewportContent } from '@/utils/viewport';
import { getLibraryViewSettings } from '@/helpers/settings';
import { DropdownProvider } from '@/context/DropdownContext';
import { CommandPaletteProvider, CommandPalette } from '@/components/command-palette';
import AtmosphereOverlay from '@/components/AtmosphereOverlay';
import AppLockScreen from '@/components/AppLockScreen';
import AppLockDialog from '@/components/settings/AppLockDialog';
import {
  startEveConnectionSync,
  useEveConnectionStore,
} from '@/services/wellread/eveConnectionStore';
import { ensureEveSidecar } from '@/services/wellread/ensureEveSidecar';
import { useAppLockStore } from '@/store/appLockStore';

const Providers = ({ children }: { children: React.ReactNode }) => {
  const { envConfig, appService } = useEnv();
  const { applyUILanguage } = useSettingsStore();
  const { applyBackgroundTexture } = useBackgroundTexture();
  const { applyEinkMode } = useEinkMode();
  const {
    isInitialized: isLockInitialized,
    isUnlocked,
    initialize: initializeAppLock,
  } = useAppLockStore();
  const iconSize = useDefaultIconSize();
  useSafeAreaInsets(); // Initialize safe area insets
  useSettingsSync(); // Adopt global settings broadcast by other windows (#4580)

  useEffect(() => {
    installViewTransitionAbortGuard();

    const handlerLanguageChanged = (lng: string) => {
      document.documentElement.lang = lng;
      // Set RTL class on document for targeted styling without affecting layout
      const dir = getDirFromUILanguage();
      if (dir === 'rtl') {
        document.documentElement.classList.add('ui-rtl');
      } else {
        document.documentElement.classList.remove('ui-rtl');
      }
    };

    const locale = getLocale();
    handlerLanguageChanged(locale);
    i18n.on('languageChanged', handlerLanguageChanged);
    return () => {
      i18n.off('languageChanged', handlerLanguageChanged);
    };
  }, []);

  useEffect(() => {
    loadDataTheme();
    if (appService) {
      initSystemThemeListener(appService);
      appService.loadSettings().then(async (settings) => {
        const globalViewSettings = settings.globalViewSettings;
        applyUILanguage(globalViewSettings.uiLanguage);
        // Seed the customTextureStore with the disk-loaded textures (preserving
        // their saved ids) so the boot-time applyBackgroundTexture below can
        // resolve a custom textureId. Without this, the store is empty until
        // ThemePanel or the replica-pull seed runs — and the in-hook addTexture
        // fallback re-derives the id from name, which mismatches whenever the
        // saved id wasn't computed from the current name (legacy imports,
        // cross-device sync, name-based id collisions).
        if (settings.customTextures?.length) {
          useCustomTextureStore.getState().setTextures(settings.customTextures);
        }
        // The app boots onto the library, so apply the library background
        // (which inherits the reader/global texture until decoupled). The
        // reader re-applies its own texture when a book opens (issue #4743).
        applyBackgroundTexture(envConfig, getLibraryViewSettings(settings));
        if (globalViewSettings.isEink) {
          applyEinkMode(true);
        }
        // Initialize the app-lock gate from on-disk settings. Until
        // this runs, the gate renders nothing — guarantees the
        // library can't flash on screen before the lock screen does.
        initializeAppLock({
          enabled: !!settings.pinCodeEnabled,
          hash: settings.pinCodeHash,
          salt: settings.pinCodeSalt,
          biometricUnlockEnabled: !!settings.biometricUnlockEnabled,
        });
        // Rust bootstrap defers spawn; ensure here with keychain apiKey +
        // active ModelProfile. Extra windows reuse the running process.
        const info = await ensureEveSidecar(settings.modelConfig);
        useEveConnectionStore.getState().applyInfo(info);
        if (!info) {
          await useEveConnectionStore.getState().refresh();
        }
      });
    }
  }, [
    envConfig,
    appService,
    applyUILanguage,
    applyBackgroundTexture,
    applyEinkMode,
    initializeAppLock,
  ]);

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const updated = getAndroidPatchedViewportContent(navigator.userAgent, meta.content);
    if (updated) meta.content = updated;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stopSync: (() => void) | undefined;
    void (async () => {
      stopSync = await startEveConnectionSync();
      if (cancelled) {
        stopSync();
        return;
      }
      await useEveConnectionStore.getState().refresh();
    })();
    return () => {
      cancelled = true;
      stopSync?.();
    };
  }, []);

  // Make sure appService is available in all children components
  if (!appService) return;

  // App-lock gate. While the lock store is uninitialized we render
  // nothing — without this guard the library would flash on screen
  // for a few hundred ms before `loadSettings` resolved and let the
  // lock store decide whether to lock.
  const showAppLockScreen = isLockInitialized && !isUnlocked;
  const appShellHidden = !isLockInitialized || !isUnlocked;

  return (
    <IconContext.Provider value={{ size: `${iconSize}px` }}>
      <DropdownProvider>
        <CommandPaletteProvider>
          <div
            aria-hidden={appShellHidden}
            style={appShellHidden ? { display: 'none' } : undefined}
          >
            {children}
            <CommandPalette />
            <AtmosphereOverlay />
          </div>
          <AppLockDialog />
          {showAppLockScreen && <AppLockScreen />}
        </CommandPaletteProvider>
      </DropdownProvider>
    </IconContext.Provider>
  );
};

export default Providers;
