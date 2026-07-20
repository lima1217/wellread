/**
 * Node-backed Books filesystem session for the eve sidecar.
 *
 * Implements the InternalSandboxSession shape (resolvePath / readFile /
 * writeFile / removePath / spawn) without importing eve — ticket 06/05
 * wire this into defineSandbox({ backend }) later.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createNodeRealpathLookup } from './nodeLookup.mjs';
import {
  WORKSPACE_ROOT,
  WRITABLE_DIR,
  authorizeRead,
  authorizeWrite,
  normalizeAbsolute,
  workspaceToHost,
} from './scopedFs.mjs';

function resolveWorkspacePath(path) {
  if (path.startsWith('/')) return path;
  return `${WORKSPACE_ROOT}/${path}`;
}

function isLexicallyWritable(workspacePath) {
  const ws = normalizeAbsolute(workspacePath);
  const prefix = `${WORKSPACE_ROOT}/${WRITABLE_DIR}`;
  return ws === prefix || ws.startsWith(`${prefix}/`);
}

export function createBooksFsSession(options) {
  const id = options.id ?? 'wellread-books';
  const lookup = createNodeRealpathLookup();

  return {
    id,
    resolvePath: resolveWorkspacePath,

    async spawn() {
      throw new Error('spawn disabled in wellread Books backend');
    },

    async run() {
      throw new Error('run disabled in wellread Books backend');
    },

    async setNetworkPolicy(_policy) {
      // no-op — Books backend does not gate network (model has no shell/network tools)
    },

    async readFile({ path }) {
      const workspacePath = resolveWorkspacePath(path);
      const booksRoot = normalizeAbsolute(options.getBooksRoot());
      const auth = authorizeRead(workspacePath, booksRoot, lookup);
      if (!auth.ok) throw new Error(auth.reason);
      try {
        return new Uint8Array(readFileSync(auth.realPath));
      } catch (err) {
        const code = err.code;
        if (code === 'ENOENT') return null;
        throw err;
      }
    },

    async writeFile({ path, content }) {
      const workspacePath = resolveWorkspacePath(path);
      const booksRoot = normalizeAbsolute(options.getBooksRoot());
      if (!isLexicallyWritable(workspacePath)) {
        throw new Error(`writes only under ${WORKSPACE_ROOT}/${WRITABLE_DIR}/`);
      }
      const mapped = workspaceToHost(workspacePath, booksRoot);
      if (!mapped.ok) throw new Error(mapped.reason);
      // Create parent dirs inside .wellread before realpath authorize (last
      // component may be new; intermediates must exist for the walker).
      mkdirSync(dirname(mapped.hostPath), { recursive: true });
      const auth = authorizeWrite(workspacePath, booksRoot, lookup);
      if (!auth.ok) throw new Error(auth.reason);
      writeFileSync(auth.realPath, content);
    },

    async removePath({ path }) {
      const workspacePath = resolveWorkspacePath(path);
      const booksRoot = normalizeAbsolute(options.getBooksRoot());
      const auth = authorizeWrite(workspacePath, booksRoot, lookup);
      if (!auth.ok) throw new Error(auth.reason);
      rmSync(auth.realPath, { recursive: true, force: true });
    },
  };
}
