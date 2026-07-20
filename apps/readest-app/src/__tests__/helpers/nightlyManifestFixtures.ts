/**
 * Manifest shapes formerly shared with the deleted nightly-verify harness.
 * Kept here so updater unit tests can assert resolveNightlyUpdate without
 * the CI-oriented HTTP harness.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../../../package.json');

const GOOD_SIG =
  'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTYnBBOWFJeEtnL3RvRC83dEJEUXZONVFZM1hranhKTUZxQzllR2lGWnNjckZMbCtOa3RXMi80aFdDYUNDUkdOa0NqUjJUQkZDL2dqaUVTeURlNzI0cW1BcUlZY2ZsOGcwPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzgxNDE0MzExCWZpbGU6bnYuYmluCkQzajlpbVZPOXVDYXdna2JBVWZ0TTE4K1d1cWdEYWVYQzVraGh4U1ZuOGNSTDZaOU5zV093OEVDajBvV0JydVV5VGY2K0tkb0hBbGJHYWprK0NsNUN3PT0K';

const ALL_KEYS = [
  'darwin-aarch64',
  'darwin-x86_64',
  'windows-x86_64',
  'windows-aarch64',
  'windows-x86_64-portable',
  'windows-aarch64-portable',
  'linux-x86_64-appimage',
  'linux-aarch64-appimage',
  'android-universal',
  'android-arm64',
];

export const baseVersion = () =>
  JSON.parse(readFileSync(PKG, 'utf8')).version.split('-')[0] as string;

const platforms = () => {
  const url = 'http://127.0.0.1:8788/artifacts/test.bin';
  return Object.fromEntries(ALL_KEYS.map((k) => [k, { url, signature: GOOD_SIG }]));
};

export const buildNightlyManifest = () => ({
  version: `${baseVersion()}-2099010100`,
  pub_date: '2099-01-01T00:00:00+08:00',
  notes: 'Harness nightly build.',
  platforms: platforms(),
});

export const buildStableManifest = (surpass = false) => {
  const parts = baseVersion().split('.').map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  const c = parts[2] ?? 0;
  return {
    version: surpass ? `${a}.${b}.${c + 1}` : `${a}.${b}.${c}`,
    pub_date: '2099-01-01T00:00:00+08:00',
    notes: 'Harness stable build.',
    platforms: platforms(),
  };
};
