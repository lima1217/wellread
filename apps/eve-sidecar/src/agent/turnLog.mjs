/**
 * Optional structured turn contract log (local sidecar stderr).
 * Enable with EVE_TURN_LOG=1.
 */

/**
 * @param {Record<string, unknown>} payload
 */
function logJson(payload) {
  if (process.env.EVE_TURN_LOG !== '1') return;
  try {
    console.error(JSON.stringify({ ts: Date.now(), ...payload }));
  } catch {
    // never break a turn for logging
  }
}

/**
 * @param {{
 *   sessionId?: string,
 *   bookId?: string,
 *   extractStatus?: string,
 *   focusVia?: string | null,
 *   focusCount?: number,
 *   sectionVia?: string | null,
 *   sectionCount?: number,
 *   skillId?: string | null,
 *   quoteCount?: number,
 * }} fields
 */
export function logTurnContract(fields) {
  logJson({ type: 'eve.turn_contract', ...fields });
}

/**
 * @param {{
 *   phase: 'start' | 'end',
 *   toolName?: string,
 *   toolCallId?: string,
 *   toolOutputType?: string,
 *   toolExecutionMs?: number,
 * }} fields
 */
export function logToolExecution(fields) {
  logJson({ type: 'eve.tool_execution', ...fields });
}
