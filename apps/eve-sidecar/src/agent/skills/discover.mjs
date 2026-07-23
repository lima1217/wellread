/**
 * Skill discovery for Reading Assistant `/skill:<id>` invocation (catalog only).
 *
 * Layers:
 *   user:    Books/skills/<id>/SKILL.md  (source: 'user')
 *   bundled: <sidecar>/bundled-skills/<id>/SKILL.md  (source: 'bundled')
 * Same id: user wins. Disabled bundled ids live in
 * Books/.wellread/disabled-bundled-skills.json (ignored when a user package exists).
 *
 * Catalog results are cached in-process and invalidated when the catalog stamp
 * changes or via {@link invalidateSkillsCache}.
 */

import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_ROOT, WRITABLE_DIR } from '../../books/scopedFs.mjs';
import { resolveBundledSkillsRoot } from './bundledRoot.mjs';

/** Host / workspace directory name under Books root. */
export const SKILLS_DIR = 'skills';

/** Relative to Books root. */
export const DISABLED_BUNDLED_SKILLS_REL = `${WRITABLE_DIR}/disabled-bundled-skills.json`;

const SKILL_FILE = 'SKILL.md';

/**
 * @typedef {'user' | 'bundled'} SkillSource
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   description: string,
 *   path: string,
 *   source: SkillSource,
 *   enabled: boolean,
 * }} SkillSummary
 *
 * @typedef {{ stamp: string, skills: SkillSummary[] }} SkillsCacheEntry
 */

/** @type {Map<string, SkillsCacheEntry>} */
const skillsCatalogCache = new Map();

/** Slash token: letter/digit start; then alnum, underscore, hyphen. */
export function isValidSkillId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id);
}

/**
 * Drop cached catalog for one Books root, or all roots when omitted.
 * Call after same-process mutations that may not bump stamp inputs.
 * @param {string} [booksRoot]
 */
export function invalidateSkillsCache(booksRoot) {
  if (typeof booksRoot === 'string' && booksRoot) {
    skillsCatalogCache.delete(cacheKeyFor(booksRoot));
    return;
  }
  skillsCatalogCache.clear();
}

/**
 * True when `dirPath` is a real directory (not a symlink). Matches
 * wellreadSearch: never follow links out of Books.
 * @param {string} dirPath
 */
export function isRegularSkillDir(dirPath) {
  try {
    const st = lstatSync(dirPath);
    return !st.isSymbolicLink() && st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read SKILL.md only if it is a regular file. Symlinks are refused so a
 * package cannot pull host files outside Books into the catalog or prompt.
 * @param {string} skillPath absolute host path to SKILL.md
 * @returns {string | null}
 */
export function readSkillMdFile(skillPath) {
  try {
    const st = lstatSync(skillPath);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    return readFileSync(skillPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * @param {string} raw
 * @returns {{ name: string, description: string, instructions: string } | null}
 */
export function parseSkillMd(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) return null;

  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    fields[m[1]] = unquoteYamlScalar(m[2].trim());
  }

  const name = (fields.name || '').trim();
  const description = (fields.description || '').trim();
  if (!name || !description) return null;

  return {
    name,
    description,
    instructions: (match[2] || '').trim(),
  };
}

/**
 * Workspace path advertised in the catalog (same for user and bundled).
 * @param {string} id
 */
export function skillWorkspacePath(id) {
  return `${WORKSPACE_ROOT}/${SKILLS_DIR}/${id}/${SKILL_FILE}`;
}

/**
 * Ids listed in Books/.wellread/disabled-bundled-skills.json.
 * @param {string} booksRoot
 * @returns {Set<string>}
 */
export function readDisabledBundledSkillIds(booksRoot) {
  if (!booksRoot || typeof booksRoot !== 'string') return new Set();
  const path = join(booksRoot, DISABLED_BUNDLED_SKILLS_REL);
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile()) return new Set();
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    /** @type {Set<string>} */
    const ids = new Set();
    for (const item of parsed) {
      if (typeof item === 'string' && isValidSkillId(item)) ids.add(item);
    }
    return ids;
  } catch {
    return new Set();
  }
}

/**
 * Absolute host path to a bundled package's SKILL.md, or null.
 * @param {string} id
 * @returns {string | null}
 */
export function bundledSkillMdHostPath(id) {
  if (!isValidSkillId(id)) return null;
  const root = resolveBundledSkillsRoot();
  if (!root) return null;
  return join(root, id, SKILL_FILE);
}

/**
 * Read bundled SKILL.md body for sandbox / load fallback.
 * @param {string} id
 * @returns {string | null}
 */
export function readBundledSkillMd(id) {
  const path = bundledSkillMdHostPath(id);
  if (!path) return null;
  return readSkillMdFile(path);
}

/**
 * @param {{ booksRoot: string, includeDisabled?: boolean }} input
 * @returns {SkillSummary[]}
 */
export function discoverSkills(input) {
  const booksRoot = input?.booksRoot;
  if (!booksRoot || typeof booksRoot !== 'string') return [];
  const includeDisabled = Boolean(input?.includeDisabled);

  const key = cacheKeyFor(booksRoot);
  const stamp = catalogStamp(booksRoot);
  const hit = skillsCatalogCache.get(key);
  /** @type {SkillSummary[]} */
  let skills;
  if (hit && hit.stamp === stamp) {
    skills = hit.skills;
  } else {
    skills = mergeSkillLayers(booksRoot);
    skillsCatalogCache.set(key, { stamp, skills });
  }

  const visible = includeDisabled ? skills : skills.filter((s) => s.enabled);
  return visible.map(cloneSkillSummary);
}

/**
 * Full merge including disabled bundled rows (`enabled: false`).
 * @param {string} booksRoot
 * @returns {SkillSummary[]}
 */
function mergeSkillLayers(booksRoot) {
  /** @type {Map<string, SkillSummary>} */
  const byId = new Map();

  for (const skill of scanSkillsRoot(join(booksRoot, SKILLS_DIR), 'user')) {
    byId.set(skill.id, { ...skill, enabled: true });
  }

  const disabled = readDisabledBundledSkillIds(booksRoot);
  const bundledRoot = resolveBundledSkillsRoot();
  if (bundledRoot) {
    for (const skill of scanSkillsRoot(bundledRoot, 'bundled')) {
      if (byId.has(skill.id)) continue;
      if (disabled.has(skill.id)) {
        byId.set(skill.id, { ...skill, enabled: false });
        continue;
      }
      byId.set(skill.id, { ...skill, enabled: true });
    }
  }

  const skills = [...byId.values()];
  skills.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return skills;
}

/**
 * @param {string} skillsRoot
 * @param {SkillSource} source
 * @returns {SkillSummary[]}
 */
function scanSkillsRoot(skillsRoot, source) {
  let entries;
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true });
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return [];
    throw error;
  }

  /** @type {SkillSummary[]} */
  const skills = [];
  for (const entry of entries) {
    const id = entry.name;
    if (!isValidSkillId(id)) continue;

    const packageDir = join(skillsRoot, id);
    if (!isRegularSkillDir(packageDir)) continue;

    const raw = readSkillMdFile(join(packageDir, SKILL_FILE));
    if (raw == null) continue;

    const parsed = parseSkillMd(raw);
    if (!parsed) continue;

    skills.push({
      id,
      name: parsed.name,
      description: parsed.description,
      path: skillWorkspacePath(id),
      source,
      // Caller sets enabled when merging layers.
      enabled: true,
    });
  }

  return skills;
}

/**
 * Catalog stamp: user skills/ + disabled file + bundled root package mtimes.
 * @param {string} booksRoot
 */
function catalogStamp(booksRoot) {
  const parts = [
    `user:${skillsDirStamp(join(booksRoot, SKILLS_DIR))}`,
    `disabled:${disabledStamp(booksRoot)}`,
    `bundled:${skillsDirStamp(resolveBundledSkillsRoot() || '')}`,
  ];
  return parts.join('||');
}

/**
 * @param {string} booksRoot
 */
function disabledStamp(booksRoot) {
  const path = join(booksRoot, DISABLED_BUNDLED_SKILLS_REL);
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile()) return 'bad';
    return String(st.mtimeMs);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return 'absent';
    throw error;
  }
}

/**
 * Catalog stamp: `skills/` mtime plus each valid package's SKILL.md mtime.
 * @param {string} skillsRoot
 */
function skillsDirStamp(skillsRoot) {
  if (!skillsRoot) return 'absent';
  try {
    const st = statSync(skillsRoot);
    if (!st.isDirectory()) return 'absent';

    /** @type {string[]} */
    const parts = [`dir:${st.mtimeMs}`];
    let entries;
    try {
      entries = readdirSync(skillsRoot, { withFileTypes: true });
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return 'absent';
      throw error;
    }

    for (const entry of entries) {
      const id = entry.name;
      if (!isValidSkillId(id)) continue;
      const packageDir = join(skillsRoot, id);
      if (!isRegularSkillDir(packageDir)) {
        parts.push(`${id}:skip`);
        continue;
      }
      try {
        const md = lstatSync(join(packageDir, SKILL_FILE));
        if (md.isSymbolicLink() || !md.isFile()) {
          parts.push(`${id}:bad`);
          continue;
        }
        parts.push(`${id}:${md.mtimeMs}`);
      } catch (error) {
        if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
          parts.push(`${id}:missing`);
          continue;
        }
        throw error;
      }
    }

    parts.sort();
    return parts.join('|');
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return 'absent';
    throw error;
  }
}

/**
 * @param {string} booksRoot
 */
function cacheKeyFor(booksRoot) {
  try {
    return realpathSync(booksRoot);
  } catch {
    return booksRoot;
  }
}

/**
 * @param {SkillSummary} skill
 * @returns {SkillSummary}
 */
function cloneSkillSummary(skill) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    path: skill.path,
    source: skill.source,
    enabled: skill.enabled,
  };
}

/**
 * @param {string} value
 */
function unquoteYamlScalar(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1);
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value);
      } catch {
        return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    }
    return inner.replace(/''/g, "'");
  }
  return value;
}
