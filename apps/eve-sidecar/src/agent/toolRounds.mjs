/**
 * Bounded tool-loop budget (Creader-aligned): default 10, clamp 2–24,
 * plus soft-landing when the budget is spent.
 *
 * Soft-landing only disables tools. Visible reply is formatToolLedger(toolTrace)
 * in runTurn — this step's model prose is never promoted.
 */

export const DEFAULT_MAX_TOOL_ROUNDS = 10;
export const MIN_MAX_TOOL_ROUNDS = 2;
export const HARD_MAX_TOOL_ROUNDS = 24;

export const TOOLS_EXHAUSTED_SYSTEM_PROMPT =
  '工具调用次数已用尽。不要再调用工具；可见回复将由已执行工具的路径台账生成，勿输出过程旁白或长文。';

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
 * disable tools. Visible reply is owned by toolLedger.mjs.
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
