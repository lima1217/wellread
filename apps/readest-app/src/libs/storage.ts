import { isWebAppPlatform } from '@/services/environment';
import { AppService } from '@/types/system';
import { tauriDownload, webDownload, ProgressHandler } from '@/utils/transfer';

type DownloadFileParams = {
  appService: AppService;
  dst: string;
  cfp: string;
  url?: string;
  headers?: Record<string, string>;
  singleThreaded?: boolean;
  skipSslVerification?: boolean;
  onProgress?: ProgressHandler;
};

/** Download a file from a direct URL (OPDS, gloss packs, etc.). Cloud signed-URL paths removed. */
export const downloadFile = async ({
  appService,
  dst,
  url,
  headers,
  singleThreaded,
  skipSslVerification,
  onProgress,
}: DownloadFileParams) => {
  if (!url) {
    throw new Error('Direct download URL required');
  }

  try {
    if (isWebAppPlatform()) {
      const { headers: responseHeaders, blob } = await webDownload(url, onProgress, headers);
      await appService.writeFile(dst, 'None', await blob.arrayBuffer());
      return responseHeaders;
    }
    return await tauriDownload(
      url,
      dst,
      onProgress,
      headers,
      undefined,
      singleThreaded,
      skipSslVerification,
    );
  } catch (error) {
    console.error(`File '${dst}' download failed:`, error);
    throw error;
  }
};
