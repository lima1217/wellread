/**
 * Bounded tool-loop budget (Creader-aligned): default 10, clamp 2–24,
 * plus a final tools-disabled step when the budget is spent.
 *
 * Exhaustion disables tools so the model must answer from prior tool results.
 * Visible reply is whatever the model streams (no ledger substitution).
 */

export const DEFAULT_MAX_TOOL_ROUNDS = 10;
export const MIN_MAX_TOOL_ROUNDS = 2;
export const HARD_MAX_TOOL_ROUNDS = 24;

export const TOOLS_EXHAUSTED_SYSTEM_PROMPT =
  '工具调用次数已用尽。不要再调用工具；根据已有工具结果直接给出完整回答。';

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
 * disable tools so the model produces a final answer.
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
