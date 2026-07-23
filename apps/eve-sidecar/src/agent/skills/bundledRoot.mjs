/**
 * Resolve the read-only bundled-skills directory shipped with the sidecar.
 *
 * Layout (same relative path in both modes):
 *   repo:    apps/eve-sidecar/bundled-skills/
 *   packaged:.output/bundled-skills/  (copied by scripts/build.mjs)
 *
 * From this module at …/agent/skills/bundledRoot.mjs → ../../../bundled-skills
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {string | null | undefined} */
let rootOverride;

/**
 * Test hook: pass a directory, or `null` to disable bundled skills, or
 * `undefined` to clear the override and use the default resolution.
 * @param {string | null | undefined} root
 */
export function setBundledSkillsRootForTests(root) {
  rootOverride = root;
}

/**
 * Absolute host path to bundled-skills/, or null when disabled / unset.
 * @returns {string | null}
 */
export function resolveBundledSkillsRoot() {
  if (rootOverride === null) return null;
  if (typeof rootOverride === 'string') {
    return rootOverride || null;
  }
  const fromEnv = process.env.WELLREAD_BUNDLED_SKILLS_ROOT;
  if (typeof fromEnv === 'string') {
    const trimmed = fromEnv.trim();
    return trimmed ? trimmed : null;
  }
  return join(dirname(fileURLToPath(import.meta.url)), '../../../bundled-skills');
}
