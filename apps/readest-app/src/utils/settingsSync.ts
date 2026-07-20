import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriAppPlatform } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';

/**
 * Cross-window global-settings sync for desktop multi-window sessions.
 */
export const SETTINGS_SYNC_EVENT = 'global-settings-window-sync';

export interface SettingsSyncPayload {
  sourceLabel: string;
  globalViewSettings: SystemSettings['globalViewSettings'];
  globalReadSettings: SystemSettings['globalReadSettings'];
}

export const mergeSyncedGlobalSettings = (
  local: SystemSettings,
  payload: Pick<SettingsSyncPayload, 'globalViewSettings' | 'globalReadSettings'>,
): SystemSettings => ({
  ...local,
  globalViewSettings: payload.globalViewSettings,
  globalReadSettings: payload.globalReadSettings,
});

export const broadcastGlobalSettings = async (settings: SystemSettings): Promise<void> => {
  if (!isTauriAppPlatform()) return;
  if (!settings.globalViewSettings || !settings.globalReadSettings) return;
  try {
    const payload: SettingsSyncPayload = {
      sourceLabel: getCurrentWindow().label,
      globalViewSettings: settings.globalViewSettings,
      globalReadSettings: settings.globalReadSettings,
    };
    await emit(SETTINGS_SYNC_EVENT, payload);
  } catch (err) {
    console.warn('Failed to broadcast settings to other windows', err);
  }
};

export const subscribeSettingsSync = async (
  onReceive: (payload: SettingsSyncPayload) => void,
): Promise<UnlistenFn> => {
  if (!isTauriAppPlatform()) return () => {};
  const currentLabel = getCurrentWindow().label;
  return listen<SettingsSyncPayload>(SETTINGS_SYNC_EVENT, ({ payload }) => {
    if (!payload || payload.sourceLabel === currentLabel) return;
    onReceive(payload);
  });
};
