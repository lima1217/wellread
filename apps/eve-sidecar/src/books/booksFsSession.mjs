/**
 * Node-backed Books filesystem session for the eve sidecar.
 *
 * Implements the InternalSandboxSession shape (resolvePath / readFile /
 * writeFile / removePath / spawn) without importing eve — ticket 06/05
 * wire this into defineSandbox({ backend }) later.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  isValidSkillId,
  parseSkillMd,
  readBundledSkillMd,
  readDisabledBundledSkillIds,
  SKILLS_DIR,
} from '../agent/skills/discover.mjs';
import { createNodeRealpathLookup } from './nodeLookup.mjs';
import {
  WORKSPACE_ROOT,
  WRITABLE_DIR,
  authorizeExistingWritePrefix,
  authorizeRead,
  authorizeWrite,
  normalizeAbsolute,
  workspaceToHost,
} from './scopedFs.mjs';

const SKILL_MD = 'SKILL.md';

/**
 * `/workspace/skills/<id>/SKILL.md` → skill id, or null when not that shape.
 * @param {string} workspacePath
 * @returns {string | null}
 */
function skillIdFromWorkspacePath(workspacePath) {
  const ws = normalizeAbsolute(workspacePath);
  const prefix = `${WORKSPACE_ROOT}/${SKILLS_DIR}/`;
  if (!ws.startsWith(prefix)) return null;
  const rest = ws.slice(prefix.length);
  const parts = rest.split('/');
  if (parts.length !== 2 || parts[1] !== SKILL_MD) return null;
  const id = parts[0];
  return isValidSkillId(id) ? id : null;
}

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
      const skillId = skillIdFromWorkspacePath(workspacePath);

      const auth = authorizeRead(workspacePath, booksRoot, lookup);
      if (auth.ok) {
        try {
          const bytes = new Uint8Array(readFileSync(auth.realPath));
          // Skill catalog paths: only a parseable SKILL.md counts as user overlay
          // (same gate as loadSkillPackage / discoverSkills). Broken user files
          // fall through to the bundled copy instead of poisoning read_file.
          if (!skillId || parseSkillMd(new TextDecoder().decode(bytes))) {
            return bytes;
          }
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
      } else if (!skillId) {
        throw new Error(auth.reason);
      }

      // Catalog path is always /workspace/skills/<id>/SKILL.md; when Books has
      // no valid package, serve the read-only bundled copy (if any and not disabled).
      if (skillId && !readDisabledBundledSkillIds(booksRoot).has(skillId)) {
        const bundled = readBundledSkillMd(skillId);
        if (bundled != null) {
          return new Uint8Array(Buffer.from(bundled, 'utf8'));
        }
      }

      if (!auth.ok) throw new Error(auth.reason);
      return null;
    },

    async writeFile({ path, content }) {
      const workspacePath = resolveWorkspacePath(path);
      const booksRoot = normalizeAbsolute(options.getBooksRoot());
      if (!isLexicallyWritable(workspacePath)) {
        throw new Error(`writes only under ${WORKSPACE_ROOT}/${WRITABLE_DIR}/`);
      }
      const mapped = workspaceToHost(workspacePath, booksRoot);
      if (!mapped.ok) throw new Error(mapped.reason);
      // Authorize the deepest existing prefix before mkdir so a symlink under
      // .wellread cannot create directories outside Books.
      const prefix = authorizeExistingWritePrefix(mapped.hostPath, booksRoot, lookup);
      if (!prefix.ok) throw new Error(prefix.reason);
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
