/**
 * `/skill:<id>` invocation: parse user text, load the matching skill package,
 * and expand into the user turn before the model sees the slash token (Pi-style).
 */

import { join } from 'node:path';
import { WORKSPACE_ROOT } from '../../books/scopedFs.mjs';
import { peelLeadingQuoteWire } from '../prompt.mjs';
import {
  SKILLS_DIR,
  isRegularSkillDir,
  isValidSkillId,
  parseSkillMd,
  readBundledSkillMd,
  readDisabledBundledSkillIds,
  readSkillMdFile,
  skillWorkspacePath,
} from './discover.mjs';

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   description: string,
 *   instructions: string,
 *   path: string,
 *   source: 'user' | 'bundled',
 * }} SkillPackage
 */

/**
 * @param {string} message
 * @returns {{ skillId: string, rest: string } | null}
 */
export function parseSlashInvocation(message) {
  if (typeof message !== 'string') return null;
  const trimmed = message.trim();
  const candidate = peelLeadingQuoteWire(trimmed).content;
  const match = candidate.match(/^\/skill:([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return {
    skillId: match[1],
    rest: (match[2] || '').trim(),
  };
}

/**
 * Keep leading Pending Quote blocks; replace the question (slash) segment.
 * @param {string} message
 * @param {string} expandedQuestion
 */
function replaceSlashQuestion(message, expandedQuestion) {
  const { quoteParts } = peelLeadingQuoteWire(message);
  if (quoteParts.length === 0) return expandedQuestion;
  return [...quoteParts, expandedQuestion].join('\n\n');
}

/**
 * Load user package first; else bundled (unless disabled without user overlay).
 * @param {string} booksRoot
 * @param {string} id
 * @returns {SkillPackage | null}
 */
export function loadSkillPackage(booksRoot, id) {
  if (!booksRoot || !isValidSkillId(id)) return null;

  const packageDir = join(booksRoot, SKILLS_DIR, id);
  if (isRegularSkillDir(packageDir)) {
    const raw = readSkillMdFile(join(packageDir, 'SKILL.md'));
    if (raw != null) {
      const parsed = parseSkillMd(raw);
      if (parsed) {
        return {
          id,
          name: parsed.name,
          description: parsed.description,
          instructions: parsed.instructions,
          path: skillWorkspacePath(id),
          source: 'user',
        };
      }
    }
  }

  if (readDisabledBundledSkillIds(booksRoot).has(id)) return null;

  const bundledRaw = readBundledSkillMd(id);
  if (bundledRaw == null) return null;
  const parsed = parseSkillMd(bundledRaw);
  if (!parsed) return null;
  return {
    id,
    name: parsed.name,
    description: parsed.description,
    instructions: parsed.instructions,
    path: skillWorkspacePath(id),
    source: 'bundled',
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
