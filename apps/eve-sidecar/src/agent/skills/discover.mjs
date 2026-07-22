/**
 * Skill discovery for Reading Assistant `/` invocation (catalog only).
 *
 * Product root: Books/skills/ ↔ /workspace/skills/
 * Package shape: skills/<id>/SKILL.md with Agent Skills frontmatter.
 */

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_ROOT } from '../../books/scopedFs.mjs';

/** Host / workspace directory name under Books root. */
export const SKILLS_DIR = 'skills';

const SKILL_FILE = 'SKILL.md';

/** Slash token: letter/digit start; then alnum, underscore, hyphen. */
export function isValidSkillId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id);
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
 * @param {{ booksRoot: string }} input
 * @returns {Array<{
 *   id: string,
 *   name: string,
 *   description: string,
 *   path: string,
 *   source: 'user',
 * }>}
 */
export function discoverSkills(input) {
  const booksRoot = input?.booksRoot;
  if (!booksRoot || typeof booksRoot !== 'string') return [];

  const skillsRoot = join(booksRoot, SKILLS_DIR);
  let entries;
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true });
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return [];
    throw error;
  }

  /** @type {Array<{ id: string, name: string, description: string, path: string, source: 'user' }>} */
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
      path: `${WORKSPACE_ROOT}/${SKILLS_DIR}/${id}/${SKILL_FILE}`,
      source: 'user',
    });
  }

  skills.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return skills;
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
