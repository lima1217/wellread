/**
 * Bounded tool-loop budget (Creader-aligned): default 10, clamp 2–24,
 * plus a final tools-disabled step when the budget is spent.
 *
 * Exhaustion disables tools so the model must answer from prior tool results.
 * Visible reply is whatever the model streams (no ledger substitution).
 *
 * Final-step maxOutputTokens is returned from prepareStep (AI SDK 6+/7
 * LanguageModelCallOptions override) so the answer step has a dedicated budget.
 */

export const DEFAULT_MAX_TOOL_ROUNDS = 10;
export const MIN_MAX_TOOL_ROUNDS = 2;
export const HARD_MAX_TOOL_ROUNDS = 24;

/** Guaranteed output budget for the tools-disabled soft-landing step. */
export const DEFAULT_FINAL_MAX_OUTPUT_TOKENS = 8192;
export const MIN_FINAL_MAX_OUTPUT_TOKENS = 1024;
export const HARD_FINAL_MAX_OUTPUT_TOKENS = 32_768;

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
 * @param {unknown} [limit]
 * @returns {number}
 */
export function resolveFinalMaxOutputTokens(limit) {
  if (limit == null || limit === '') return DEFAULT_FINAL_MAX_OUTPUT_TOKENS;
  const raw = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isFinite(raw)) return DEFAULT_FINAL_MAX_OUTPUT_TOKENS;
  return Math.min(
    HARD_FINAL_MAX_OUTPUT_TOKENS,
    Math.max(MIN_FINAL_MAX_OUTPUT_TOKENS, Math.round(raw)),
  );
}

/**
 * AI SDK prepareStep soft-landing: after maxToolRounds tool-capable steps,
 * disable tools so the model produces a final answer with a dedicated
 * output-token budget.
 *
 * @param {{
 *   stepNumber: number,
 *   maxToolRounds: number,
 *   instructions: string,
 *   maxOutputTokens?: number,
 * }} input
 * @returns {{
 *   toolChoice: 'none',
 *   activeTools: [],
 *   instructions: string,
 *   maxOutputTokens: number,
 * } | undefined}
 */
export function prepareToolExhaustionStep(input) {
  if (input.stepNumber < input.maxToolRounds) return undefined;
  const maxOutputTokens = resolveFinalMaxOutputTokens(input.maxOutputTokens);
  return {
    toolChoice: /** @type {const} */ ('none'),
    activeTools: /** @type {[]} */ ([]),
    instructions: `${input.instructions}\n\n${TOOLS_EXHAUSTED_SYSTEM_PROMPT}`,
    maxOutputTokens,
  };
}
