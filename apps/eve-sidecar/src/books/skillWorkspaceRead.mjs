/**
 * Skill package workspace reads: user overlay vs bundled preference.
 * Owns Books/skills overlay rules so the FS session stays a thin adapter.
 */

import { readFileSync } from 'node:fs';
import {
  canonicalBundledSkillRel,
  isBundledOnlySkillRel,
  normalizeSkillRel,
} from '@wellread/skill-contract';
import {
  parseSkillMd,
  parseSkillPackagePath,
  readBundledSkillFile,
  readDisabledBundledSkillIds,
} from '../agent/skills/discover.mjs';
import { authorizeRead, normalizeAbsolute } from './scopedFs.mjs';

const SKILL_MD = 'SKILL.md';

export {
  canonicalBundledSkillRel,
  isBundledOnlySkillRel,
  normalizeSkillRel,
  preferBundledSkillRel,
} from '@wellread/skill-contract';

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
  const isSkillMd = normalizeSkillRel(skillRef.relPath) === normalizeSkillRel(SKILL_MD);
  const bundledOnly = isBundledOnlySkillRel(skillRef.relPath);
  const disabled = readDisabledBundledSkillIds(root).has(skillRef.id);

  // PACKAGE.md / AGENTS.md / tools/* — never serve user overlay (instruction
  // injection). Independent of disabled: a disabled bundled skill must not
  // expose poison overlay copies of the pinned surfaces.
  if (bundledOnly) {
    if (disabled) {
      return { handled: true, bytes: null };
    }
    const bundledRel = canonicalBundledSkillRel(skillRef.relPath);
    const bundled = readBundledSkillFile(skillRef.id, bundledRel);
    if (bundled != null) {
      return { handled: true, bytes: new Uint8Array(Buffer.from(bundled, 'utf8')) };
    }
    // Bundled skill lacks this pin — do not fall through to user overlay.
    return { handled: true, bytes: null };
  }

  if (!disabled) {
    // Prefer valid user SKILL.md; invalid/missing falls through to bundled.
    if (isSkillMd) {
      const userAuth = authorizeRead(workspacePath, root, lookup);
      if (userAuth.ok) {
        try {
          const raw = readFileSync(userAuth.realPath, 'utf8');
          if (parseSkillMd(raw)) {
            return { handled: true, bytes: new Uint8Array(Buffer.from(raw, 'utf8')) };
          }
        } catch {
          // fall through to bundled
        }
      }
    } else {
      const userAuth = authorizeRead(workspacePath, root, lookup);
      if (userAuth.ok) {
        try {
          return { handled: true, bytes: new Uint8Array(readFileSync(userAuth.realPath)) };
        } catch {
          // fall through to bundled
        }
      }
    }
  }

  const bundled = readBundledSkillFile(skillRef.id, skillRef.relPath);
  if (bundled != null) {
    return { handled: true, bytes: new Uint8Array(Buffer.from(bundled, 'utf8')) };
  }
  return { handled: true, bytes: null };
}
