import { clearSecureItem, getSecureItem, setSecureItem } from '@/utils/bridge';
import { LEGACY_MODEL_API_KEY_SECURE_ITEM, modelApiKeySecureItem } from './modelConfig';
import { isTauriAppPlatform } from '@/services/environment';

async function readSecure(key: string): Promise<string> {
  try {
    const res = await getSecureItem({ key });
    return res.value ?? '';
  } catch {
    return '';
  }
}

/**
 * Read the BYO model apiKey for a profile from OS keychain.
 * Migrates the legacy single-slot key into the per-profile slot on first read.
 */
export async function getModelApiKey(profileId: string): Promise<string> {
  if (!isTauriAppPlatform() || !profileId) return '';
  const slot = modelApiKeySecureItem(profileId);
  const existing = (await readSecure(slot)).trim();
  if (existing) return existing;

  const legacy = (await readSecure(LEGACY_MODEL_API_KEY_SECURE_ITEM)).trim();
  if (!legacy) return '';

  try {
    await setSecureItem({ key: slot, value: legacy });
    await clearSecureItem({ key: LEGACY_MODEL_API_KEY_SECURE_ITEM });
  } catch {
    // Still return the legacy value so cold-start sync can proceed.
  }
  return legacy;
}

/** Persist apiKey for a profile. Empty string clears that profile's slot. */
export async function setModelApiKey(profileId: string, apiKey: string): Promise<void> {
  if (!isTauriAppPlatform() || !profileId) return;
  const slot = modelApiKeySecureItem(profileId);
  const trimmed = apiKey.trim();
  if (!trimmed) {
    await clearSecureItem({ key: slot });
    return;
  }
  await setSecureItem({ key: slot, value: trimmed });
}

/** Clear the keychain slot for a deleted profile. */
export async function clearModelApiKey(profileId: string): Promise<void> {
  if (!isTauriAppPlatform() || !profileId) return;
  try {
    await clearSecureItem({ key: modelApiKeySecureItem(profileId) });
  } catch {
    // ignore missing / non-Tauri failures
  }
}
