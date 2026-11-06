/**
 * Where external MCP clients find the running sidecar.
 *
 * The sidecar listens on a random port with a per-launch token and restarts
 * on model changes, so the stdio bridge (mcpBridge.mjs) re-reads this file on
 * every request instead of being configured with a URL. The file holds an
 * MCP-only token (it opens /mcp, never the turn / session API) and is 0600.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MCP_ENDPOINT_FILE = 'mcp-endpoint.json';

/** @param {string} dataDir */
export function mcpEndpointPath(dataDir) {
  return join(dataDir, MCP_ENDPOINT_FILE);
}

export function createMcpToken() {
  return randomBytes(24).toString('hex');
}

/**
 * @param {string} dataDir
 * @param {{ url: string, token: string }} endpoint
 */
export function writeMcpEndpoint(dataDir, endpoint) {
  const path = mcpEndpointPath(dataDir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...endpoint, pid: process.pid })}\n`, {
    mode: 0o600,
  });
  renameSync(tmp, path);
}

/** Remove the file only if this process still owns it (a restart may have replaced it). */
export function removeMcpEndpoint(dataDir) {
  const path = mcpEndpointPath(dataDir);
  try {
    const current = JSON.parse(readFileSync(path, 'utf8'));
    if (current?.pid === process.pid) rmSync(path, { force: true });
  } catch {
    // Missing or unreadable: nothing of ours to remove.
  }
}

/**
 * The command an MCP client runs: the same Node runtime as the sidecar, the
 * bridge script shipped next to this module, and this endpoint file.
 * @param {string} dataDir
 */
export function mcpBridgeCommand(dataDir) {
  return {
    command: process.execPath,
    args: [
      fileURLToPath(new URL('./mcpBridge.mjs', import.meta.url)),
      '--endpoint-file',
      mcpEndpointPath(dataDir),
    ],
  };
}
