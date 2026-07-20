import { getAPIBaseUrl } from '@/services/environment';
import { stubTranslation as _ } from '@/utils/misc';
import { DEFAULT_DAILY_TRANSLATION_QUOTA } from '@/services/constants';
import { ErrorCodes, TranslationProvider } from '../types';
import { normalizeToShortLang } from '@/utils/lang';
import { saveDailyUsage } from '../utils';

const DEEPL_API_ENDPOINT = getAPIBaseUrl() + '/deepl/translate';

export const deeplProvider: TranslationProvider = {
  name: 'deepl',
  label: _('DeepL'),
  authRequired: false,
  quotaExceeded: false,
  translate: async (
    text: string[],
    sourceLang: string,
    targetLang: string,
    _token?: string | null,
    useCache: boolean = false,
  ): Promise<string[]> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const normalizedSourceLang = normalizeToShortLang(sourceLang).toUpperCase();
    const body = JSON.stringify({
      text: text,
      ...(normalizedSourceLang !== 'AUTO' ? { source_lang: normalizedSourceLang } : {}),
      target_lang: normalizeToShortLang(targetLang).toUpperCase(),
      use_cache: useCache,
    });

    const quota = DEFAULT_DAILY_TRANSLATION_QUOTA.free;
    try {
      const response = await fetch(DEEPL_API_ENDPOINT, { method: 'POST', headers, body });

      if (!response.ok) {
        const data = await response.json();
        if (data && data.error && data.error === ErrorCodes.DAILY_QUOTA_EXCEEDED) {
          saveDailyUsage(quota);
          deeplProvider.quotaExceeded = true;
          throw new Error(ErrorCodes.DAILY_QUOTA_EXCEEDED);
        }
        throw new Error(`Translation failed with status ${response.status}`);
      }

      const data = await response.json();
      if (!data || !data.translations) {
        throw new Error('Invalid response from translation service');
      }

      return text.map((line, i) => {
        if (!line?.trim().length) {
          return line;
        }
        const translation = data.translations?.[i];
        if (translation?.daily_usage) {
          saveDailyUsage(translation.daily_usage);
          deeplProvider.quotaExceeded = data.daily_usage >= quota;
        }
        return translation?.text || line;
      });
    } catch (error) {
      throw error;
    }
  },
};
