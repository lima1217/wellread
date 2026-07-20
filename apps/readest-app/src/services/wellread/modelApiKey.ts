import { clearSecureItem, getSecureItem, setSecureItem } from '@/utils/bridge';
import { MODEL_API_KEY_SECURE_ITEM } from './modelConfig';
import { isTauriAppPlatform } from '@/services/environment';

/** Read the BYO model apiKey from OS keychain (empty when absent / non-Tauri). */
export async function getModelApiKey(): Promise<string> {
  if (!isTauriAppPlatform()) return '';
  try {
    const res = await getSecureItem({ key: MODEL_API_KEY_SECURE_ITEM });
    return res.value ?? '';
  } catch {
    return '';
  }
}

/** Persist apiKey to keychain. Empty string clears the item. */
export async function setModelApiKey(apiKey: string): Promise<void> {
  if (!isTauriAppPlatform()) return;
  const trimmed = apiKey.trim();
  if (!trimmed) {
    await clearSecureItem({ key: MODEL_API_KEY_SECURE_ITEM });
    return;
  }
  await setSecureItem({ key: MODEL_API_KEY_SECURE_ITEM, value: trimmed });
}
