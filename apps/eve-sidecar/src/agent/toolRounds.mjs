/**
 * Bounded tool-loop budget (Creader-aligned): default 10, clamp 2–24,
 * plus soft-landing when the budget is spent.
 */

import { collectToolPathsFromSteps } from './answerQuality.mjs';

export const DEFAULT_MAX_TOOL_ROUNDS = 10;
export const MIN_MAX_TOOL_ROUNDS = 2;
export const HARD_MAX_TOOL_ROUNDS = 24;

/** Max paths listed in the soft-landing system nudge (keep prompt bounded). */
export const SOFT_LANDING_PATHS_MAX = 80;

export const TOOLS_EXHAUSTED_SYSTEM_PROMPT =
  '工具调用次数已用尽。禁止再说「让我继续」「请继续」「继续阅读」或任何过程旁白；不要假装还在读文件。基于已获取的信息直接作答；末尾用一行列出仍缺或无法确认的部分。';

/**
 * @param {unknown} [limit]
 * @returns {number}
 */
export function resolveMaxToolRounds(limit) {
  if (limit == null || limit === '') return DEFAULT_MAX_TOOL_ROUNDS;
  const raw = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isFinite(raw)) return DEFAULT_MAX_TOOL_ROUNDS;
  return Math.min(
    HARD_MAX_TOOL_ROUNDS,
    Math.max(MIN_MAX_TOOL_ROUNDS, Math.round(raw)),
  );
}

/**
 * @param {string[]} paths
 * @returns {string}
 */
export function formatReadPathsBlock(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return '';
  const shown = paths.slice(0, SOFT_LANDING_PATHS_MAX);
  const lines = shown.map((p) => `- ${p}`);
  const more =
    paths.length > SOFT_LANDING_PATHS_MAX
      ? `\n（另有 ${paths.length - SOFT_LANDING_PATHS_MAX} 个路径未列出）`
      : '';
  return `已读取路径（共 ${paths.length} 个）：\n${lines.join('\n')}${more}`;
}

/**
 * AI SDK prepareStep soft-landing: after maxToolRounds tool-capable steps,
 * disable tools and nudge a final grounded answer with paths already read.
 *
 * @param {{
 *   stepNumber: number,
 *   maxToolRounds: number,
 *   system: string,
 *   steps?: unknown,
 *   readPaths?: string[],
 * }} input
 * @returns {{ toolChoice: 'none', activeTools: [], system: string } | undefined}
 */
export function prepareToolExhaustionStep(input) {
  if (input.stepNumber < input.maxToolRounds) return undefined;
  const paths =
    Array.isArray(input.readPaths) && input.readPaths.length
      ? input.readPaths
      : collectToolPathsFromSteps(input.steps);
  const pathBlock = formatReadPathsBlock(paths);
  const nudge = pathBlock
    ? `${TOOLS_EXHAUSTED_SYSTEM_PROMPT}\n\n${pathBlock}`
    : TOOLS_EXHAUSTED_SYSTEM_PROMPT;
  return {
    toolChoice: /** @type {const} */ ('none'),
    activeTools: /** @type {[]} */ ([]),
    system: `${input.system}\n\n${nudge}`,
  };
}
