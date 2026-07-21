/**
 * UpdaterContent — the "What's New in Wellread" changelog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: {
      hasUpdater: false,
      isIOSApp: false,
      isMacOSApp: false,
      isAndroidApp: false,
    },
  }),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

const mockAppVersion = '0.11.0';
vi.mock('@/utils/version', async () => {
  const actual = await vi.importActual<typeof import('@/utils/version')>('@/utils/version');
  return { ...actual, getAppVersion: () => mockAppVersion };
});

vi.mock('@/helpers/updater', () => ({
  setLastShownReleaseNotesVersion: vi.fn(),
}));

vi.mock('@/services/constants', () => ({
  WELLREAD_UPDATER_FILE: 'https://example.com/latest.json',
  WELLREAD_CHANGELOG_FILE: 'https://example.com/release-notes.json',
  WELLREAD_UPDATER_PUBKEY: 'pk',
}));

// ── Tauri / heavy modules pulled in by UpdaterWindow's top-level imports ──
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'macos', arch: () => 'aarch64' }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn(), Update: class {} }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(), exit: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: vi.fn() } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ desktopDir: vi.fn(), join: vi.fn() }));
vi.mock('@/utils/transfer', () => ({ tauriDownload: vi.fn() }));
vi.mock('@/utils/bridge', () => ({
  installPackage: vi.fn(),
  verifyUpdateSignature: vi.fn(),
  installNightlyUpdate: vi.fn(),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/Dialog', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/Link', () => ({ default: () => null }));

import { UpdaterContent } from '@/components/UpdaterWindow';

const RELEASE_NOTES = {
  releases: {
    '0.11.18': { date: '2026-07-08', notes: ['First feature', 'Second feature'] },
  },
};

beforeEach(() => {
  window.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => RELEASE_NOTES,
  })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
});

describe('UpdaterContent — changelog', () => {
  it('renders release notes', async () => {
    render(<UpdaterContent checkUpdate={false} latestVersion='0.11.18' lastVersion='0.11.0' />);

    await waitFor(() => expect(screen.getByText('First feature')).toBeTruthy());
    expect(screen.getByText('Second feature')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show original' })).toBeNull();
  });
});
