/**
 * `/skill:<id>` invocation: parse user text, load the matching skill package,
 * and expand into the user turn before the model sees the slash token (Pi-style).
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
 * @typedef {{
 *   id: string,
 *   name: string,
 *   description: string,
 *   instructions: string,
 *   path: string,
 *   source: 'user',
 * }} SkillPackage
 */

/**
 * @param {string} message
 * @returns {{ skillId: string, rest: string } | null}
 */
export function parseSlashInvocation(message) {
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();
  const candidate = slashCandidateFromTurn(trimmed);
  const match = candidate.match(/^\/skill:([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s+([\s\S]*))?$/);
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
 * Keep leading Pending Quote blocks; replace the question (slash) segment.
 * @param {string} message
 * @param {string} expandedQuestion
 */
function replaceSlashQuestion(message, expandedQuestion) {
  const trimmed = typeof message === 'string' ? message.trim() : '';
  if (!trimmed.startsWith('>')) return expandedQuestion;

  const parts = trimmed.split(/\n\n+/);
  const quoteParts = [];
  let i = 0;
  for (; i < parts.length; i++) {
    const block = (parts[i] || '').trim();
    if (!block) continue;
    const lines = block.split('\n');
    if (!lines.every((line) => line.startsWith('>'))) break;
    quoteParts.push(parts[i]);
  }
  if (quoteParts.length === 0) return expandedQuestion;
  return [...quoteParts, expandedQuestion].join('\n\n');
}

/**
 * @param {string} booksRoot
 * @param {string} id
 * @returns {SkillPackage | null}
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
 * Format a skill invocation prompt (Pi-compatible `<skill>` block).
 * Frontmatter is already stripped via {@link loadSkillPackage} → instructions.
 *
 * @param {Pick<SkillPackage, 'id' | 'path' | 'instructions'>} skill
 * @param {string} [additionalInstructions] args after `/skill:<id>`
 */
export function formatSkillInvocation(skill, additionalInstructions) {
  const location = skill.path;
  const baseDir = location.replace(/\/SKILL\.md$/i, '') || `${WORKSPACE_ROOT}/${SKILLS_DIR}/${skill.id}`;
  const body = (skill.instructions || '').trim() || '(no instructions in SKILL.md)';
  const skillBlock = `<skill name="${skill.id}" location="${location}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>`;
  const rest = typeof additionalInstructions === 'string' ? additionalInstructions.trim() : '';
  return rest ? `${skillBlock}\n\n${rest}` : skillBlock;
}

/**
 * Expand `/skill:<id> args` (and Pending Quote + slash) into a model-facing user turn.
 * Display/session keep the original slash text; only `modelMessage` is expanded.
 *
 * @param {string} message
 * @param {string} booksRoot
 * @returns {{
 *   displayMessage: string,
 *   modelMessage: string,
 *   skill: SkillPackage | null,
 * }}
 */
export function expandSkillCommand(message, booksRoot) {
  const displayMessage = typeof message === 'string' ? message : '';
  const parsed = parseSlashInvocation(displayMessage);
  if (!parsed) {
    return { displayMessage, modelMessage: displayMessage, skill: null };
  }

  let skill = null;
  try {
    skill = loadSkillPackage(booksRoot, parsed.skillId);
  } catch {
    skill = null;
  }
  if (!skill) {
    return { displayMessage, modelMessage: displayMessage, skill: null };
  }

  const expandedQuestion = formatSkillInvocation(skill, parsed.rest || undefined);
  return {
    displayMessage,
    modelMessage: replaceSlashQuestion(displayMessage, expandedQuestion),
    skill,
  };
}

/**
 * Parse a skill block from model-facing message text (Pi UI collapse helper).
 * @param {string} text
 * @returns {{
 *   name: string,
 *   location: string,
 *   content: string,
 *   userMessage: string | undefined,
 * } | null}
 */
export function parseSkillBlock(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(
    /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/,
  );
  if (!match) return null;
  return {
    name: match[1],
    location: match[2],
    content: match[3],
    userMessage: match[4]?.trim() || undefined,
  };
}
