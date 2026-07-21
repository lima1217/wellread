/**
 * Bounded tool-loop budget (Creader-aligned): default 10, clamp 2–24,
 * plus soft-landing when the budget is spent.
 */

export const DEFAULT_MAX_TOOL_ROUNDS = 10;
export const MIN_MAX_TOOL_ROUNDS = 2;
export const HARD_MAX_TOOL_ROUNDS = 24;

export const TOOLS_EXHAUSTED_SYSTEM_PROMPT =
  '工具调用次数已用尽。请基于已获取的信息直接作答，并在末尾用一行说明还缺少哪些信息或无法确认的部分，不要继续要求调用工具。';

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
 * AI SDK prepareStep soft-landing: after maxToolRounds tool-capable steps,
 * disable tools and nudge a final grounded answer.
 *
 * @param {{
 *   stepNumber: number,
 *   maxToolRounds: number,
 *   system: string,
 * }} input
 * @returns {{ toolChoice: 'none', activeTools: [], system: string } | undefined}
 */
export function prepareToolExhaustionStep(input) {
  if (input.stepNumber < input.maxToolRounds) return undefined;
  return {
    toolChoice: /** @type {const} */ ('none'),
    activeTools: /** @type {[]} */ ([]),
    system: `${input.system}\n\n${TOOLS_EXHAUSTED_SYSTEM_PROMPT}`,
  };
}
