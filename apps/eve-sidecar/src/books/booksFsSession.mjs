/**
 * Node-backed Books filesystem session for the eve sidecar.
 *
 * Implements the InternalSandboxSession shape (resolvePath / readFile /
 * writeFile / removePath / spawn) without importing eve — ticket 06/05
 * wire this into defineSandbox({ backend }) later.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isSafeBookIdSegment } from '../agent/notesOkf.mjs';
import {
  parseSkillMd,
  parseSkillPackagePath,
  readBundledSkillFile,
  readDisabledBundledSkillIds,
} from '../agent/skills/discover.mjs';
import { createNodeRealpathLookup } from './nodeLookup.mjs';
import {
  WORKSPACE_ROOT,
  WRITABLE_DIR,
  authorizeExistingWritePrefix,
  authorizeRead,
  authorizeWrite,
  isPathUnderRoot,
  normalizeAbsolute,
  workspaceToHost,
} from './scopedFs.mjs';

const SKILL_MD = 'SKILL.md';

/**
 * Skill package paths that must not be overridden by Books/skills user files
 * (instruction / validator surface — always prefer bundled).
 * @param {string} relPath
 */
export function preferBundledSkillRel(relPath) {
  if (relPath === 'PACKAGE.md' || relPath === 'AGENTS.md') return true;
  if (relPath === 'tools' || relPath.startsWith('tools/')) return true;
  return false;
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
      const skillRef = parseSkillPackagePath(workspacePath);
      const isSkillMd = Boolean(skillRef && skillRef.relPath === SKILL_MD);
      const bundledOnly = Boolean(skillRef && preferBundledSkillRel(skillRef.relPath));
      const disabled = skillRef
        ? readDisabledBundledSkillIds(booksRoot).has(skillRef.id)
        : false;

      // PACKAGE.md / AGENTS.md / tools/* — never serve user overlay (instruction injection).
      if (skillRef && bundledOnly && !disabled) {
        const bundled = readBundledSkillFile(skillRef.id, skillRef.relPath);
        if (bundled != null) {
          return new Uint8Array(Buffer.from(bundled, 'utf8'));
        }
        return null;
      }

      const auth = authorizeRead(workspacePath, booksRoot, lookup);
      if (auth.ok) {
        try {
          const bytes = new Uint8Array(readFileSync(auth.realPath));
          // Skill catalog SKILL.md: only a parseable package counts as user overlay
          // (same gate as loadSkillPackage / discoverSkills). Broken user files
          // fall through to the bundled copy instead of poisoning read_file.
          if (!isSkillMd || parseSkillMd(new TextDecoder().decode(bytes))) {
            return bytes;
          }
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
      } else if (!skillRef) {
        throw new Error(auth.reason);
      }

      // /workspace/skills/<id>/… — Books miss or bad SKILL.md → bundled package file.
      if (skillRef && !disabled) {
        const bundled = readBundledSkillFile(skillRef.id, skillRef.relPath);
        if (bundled != null) {
          return new Uint8Array(Buffer.from(bundled, 'utf8'));
        }
      }

      if (!auth.ok) throw new Error(auth.reason);
      return null;
    },

    /**
     * @param {{ path: string, content: Uint8Array | Buffer | string, confineNotesBookId?: string }} input
     */
    async writeFile({ path, content, confineNotesBookId }) {
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
      if (confineNotesBookId !== undefined) {
        if (!isSafeBookIdSegment(confineNotesBookId)) {
          throw new Error('write_file requires a valid session bookId');
        }
        const notesHost = normalizeAbsolute(
          `${booksRoot}/${WRITABLE_DIR}/notes/${confineNotesBookId}`,
        );
        if (!isPathUnderRoot(auth.realPath, notesHost)) {
          throw new Error(
            `writes only under ${WORKSPACE_ROOT}/${WRITABLE_DIR}/notes/${confineNotesBookId}/ (realpath escaped)`,
          );
        }
      }
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
