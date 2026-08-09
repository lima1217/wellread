/**
 * Bundled-only skill package path SSOT.
 * Host import and sidecar overlay must agree on PACKAGE.md / AGENTS.md / tools/*.
 */

/**
 * Normalize skill-relative paths for case-insensitive pin matching
 * (macOS APFS default is case-insensitive; exact string match would let
 * `package.md` slip past the PACKAGE.md pin).
 * @param {string} relPath
 */
export function normalizeSkillRel(relPath) {
  return String(relPath ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

/**
 * True for PACKAGE.md / AGENTS.md / tools/* (case-insensitive).
 * These surfaces must stay bundled — never imported or overlaid from Books/skills.
 * @param {string} relPath
 */
export function isBundledOnlySkillRel(relPath) {
  const rel = normalizeSkillRel(relPath);
  if (rel === 'package.md' || rel === 'agents.md') return true;
  if (rel === 'tools' || rel.startsWith('tools/')) return true;
  return false;
}

/** Alias kept for sidecar call sites that historically used this name. */
export function preferBundledSkillRel(relPath) {
  return isBundledOnlySkillRel(relPath);
}

/**
 * Canonical relative path for bundled-only surfaces so case variants
 * (`package.md`, `Tools/…`) resolve to the on-disk bundled names.
 * @param {string} relPath
 */
export function canonicalBundledSkillRel(relPath) {
  const rel = normalizeSkillRel(relPath);
  if (rel === 'package.md') return 'PACKAGE.md';
  if (rel === 'agents.md') return 'AGENTS.md';
  if (rel === 'tools') return 'tools';
  if (rel.startsWith('tools/')) {
    const rest = String(relPath ?? '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')
      .slice(1)
      .join('/');
    return rest ? `tools/${rest}` : 'tools';
  }
  return relPath;
}
