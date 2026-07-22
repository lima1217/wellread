/**
 * `/skillId` invocation: parse user text and load the matching skill package.
 */

import { join } from 'node:path';
import { WORKSPACE_ROOT } from '../../books/scopedFs.mjs';
import {
  SKILLS_DIR,
  isRegularSkillDir,
  isValidSkillId,
  parseSkillMd,
  readSkillMdFile,
} from './discover.mjs';

/**
 * @param {string} message
 * @returns {{ skillId: string, rest: string } | null}
 */
export function parseSlashInvocation(message) {
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();
  const candidate = slashCandidateFromTurn(trimmed);
  const match = candidate.match(/^\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return {
    skillId: match[1],
    rest: (match[2] || '').trim(),
  };
}

/**
 * Pending Quote wire puts `> …` blocks before the question. Slash commands
 * live in the question only. Mirrors client `parsePendingQuotesFromWire`:
 * peel leading quote blocks; the remainder (joined) is the question.
 * @param {string} trimmed
 */
function slashCandidateFromTurn(trimmed) {
  if (!trimmed.startsWith('>')) return trimmed;
  const parts = trimmed.split(/\n\n+/);
  let i = 0;
  for (; i < parts.length; i++) {
    const block = (parts[i] || '').trim();
    if (!block) continue;
    const lines = block.split('\n');
    if (!lines.every((line) => line.startsWith('>'))) break;
  }
  return parts.slice(i).join('\n\n').trim();
}

/**
 * @param {string} booksRoot
 * @param {string} id
 * @returns {{
 *   id: string,
 *   name: string,
 *   description: string,
 *   instructions: string,
 *   path: string,
 *   source: 'user',
 * } | null}
 */
export function loadSkillPackage(booksRoot, id) {
  if (!booksRoot || !isValidSkillId(id)) return null;
  const packageDir = join(booksRoot, SKILLS_DIR, id);
  if (!isRegularSkillDir(packageDir)) return null;
  const raw = readSkillMdFile(join(packageDir, 'SKILL.md'));
  if (raw == null) return null;
  const parsed = parseSkillMd(raw);
  if (!parsed) return null;
  return {
    id,
    name: parsed.name,
    description: parsed.description,
    instructions: parsed.instructions,
    path: `${WORKSPACE_ROOT}/${SKILLS_DIR}/${id}/SKILL.md`,
    source: 'user',
  };
}

/**
 * @param {string} message
 * @param {string} booksRoot
 */
export function resolveSkillForMessage(message, booksRoot) {
  const parsed = parseSlashInvocation(message);
  if (!parsed) return null;
  return loadSkillPackage(booksRoot, parsed.skillId);
}

/**
 * @param {string} system
 * @param {{ id: string, name: string, instructions: string }} skill
 */
export function appendActiveSkillPrompt(system, skill) {
  const body = (skill.instructions || '').trim() || '(no instructions in SKILL.md)';
  return [
    system,
    '',
    `## Active skill /${skill.id} (${skill.name})`,
    body,
    `Follow this skill for the current user turn. The user message may begin with /${skill.id}.`,
  ].join('\n');
}
