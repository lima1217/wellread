const LOCAL_SERVER_URL_PATTERN = /https?:\/\/(?:\[[^\]\s]+\]|[^\s/:[\]]+)(?::\d+)?/;
const WILDCARD_LISTEN_HOSTNAMES = new Set(['[::]', '::', '0.0.0.0']);

/**
 * Parse a Nitro/eve listen URL from sidecar stdout and normalize wildcards
 * to loopback so the WebView can reach the process.
 */
export function parseEveListenUrl(output: string): string | undefined {
  const match = LOCAL_SERVER_URL_PATTERN.exec(output);
  if (!match) return undefined;

  const url = new URL(match[0]);
  if (WILDCARD_LISTEN_HOSTNAMES.has(url.hostname)) {
    url.hostname = '127.0.0.1';
  }
  if (!url.pathname || url.pathname === '') {
    url.pathname = '/';
  }
  return url.toString();
}
