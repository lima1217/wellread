export interface WellreadRuntimeConfig {
  apiBaseUrl?: string;
}

declare global {
  interface Window {
    __WELLREAD_RUNTIME_CONFIG?: WellreadRuntimeConfig;
  }
}

export const getRuntimeConfig = () =>
  typeof window === 'undefined' ? undefined : window.__WELLREAD_RUNTIME_CONFIG;

export const getServerRuntimeConfig = (): WellreadRuntimeConfig => ({
  apiBaseUrl:
    process.env['API_BASE_URL'] ??
    process.env['NEXT_PUBLIC_API_BASE_URL'] ??
    process.env['SITE_URL'],
});
