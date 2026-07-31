/**
 * Skill package workspace reads: user overlay vs bundled preference.
 * Owns Books/skills overlay rules so the FS session stays a thin adapter.
 */

import { readFileSync } from 'node:fs';
import {
  parseSkillMd,
  parseSkillPackagePath,
  readBundledSkillFile,
  readDisabledBundledSkillIds,
} from '../agent/skills/discover.mjs';
import { authorizeRead, normalizeAbsolute } from './scopedFs.mjs';

const SKILL_MD = 'SKILL.md';

/**
 * Skill package paths that must not be overridden by Books/skills user files
 * (instruction / validator surface — always prefer bundled).
 * @param {string} relPath
 */
function preferBundledSkillRel(relPath) {
  if (relPath === 'PACKAGE.md' || relPath === 'AGENTS.md') return true;
  if (relPath === 'tools' || relPath.startsWith('tools/')) return true;
  return false;
}

/**
 * Resolve `/workspace/skills/<id>/…` bytes (overlay + disable + bundled).
 *
 * @param {string} workspacePath
 * @param {string} booksRoot
 * @param {{ realpath: (path: string) => string }} lookup
 * @returns {{ handled: false } | { handled: true, bytes: Uint8Array | null }}
 */
export function readWorkspaceSkillFile(workspacePath, booksRoot, lookup) {
  const skillRef = parseSkillPackagePath(workspacePath);
  if (!skillRef) return { handled: false };

  const root = normalizeAbsolute(booksRoot);
  const isSkillMd = skillRef.relPath === SKILL_MD;
  const bundledOnly = preferBundledSkillRel(skillRef.relPath);
  const disabled = readDisabledBundledSkillIds(root).has(skillRef.id);

  // PACKAGE.md / AGENTS.md / tools/* — never serve user overlay (instruction injection).
  if (bundledOnly && !disabled) {
    const bundled = readBundledSkillFile(skillRef.id, skillRef.relPath);
    if (bundled != null) {
      return { handled: true, bytes: new Uint8Array(Buffer.from(bundled, 'utf8')) };
    }
    return { handled: true, bytes: null };
  }

  const auth = authorizeRead(workspacePath, root, lookup);
  if (auth.ok) {
    try {
      const bytes = new Uint8Array(readFileSync(auth.realPath));
      // Skill catalog SKILL.md: only a parseable package counts as user overlay
      // (same gate as loadSkillPackage / discoverSkills). Broken user files
      // fall through to the bundled copy instead of poisoning read_file.
      if (!isSkillMd || parseSkillMd(new TextDecoder().decode(bytes))) {
        return { handled: true, bytes };
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  // /workspace/skills/<id>/… — Books miss or bad SKILL.md → bundled package file.
  if (!disabled) {
    const bundled = readBundledSkillFile(skillRef.id, skillRef.relPath);
    if (bundled != null) {
      return { handled: true, bytes: new Uint8Array(Buffer.from(bundled, 'utf8')) };
    }
  }

  if (!auth.ok) throw new Error(auth.reason);
  return { handled: true, bytes: null };
}
