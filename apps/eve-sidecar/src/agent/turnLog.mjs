/**
 * Optional structured turn contract log (local sidecar stderr).
 * Enable with EVE_TURN_LOG=1.
 */

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
  if (process.env.EVE_TURN_LOG !== '1') return;
  try {
    console.error(
      JSON.stringify({
        type: 'eve.turn_contract',
        ts: Date.now(),
        ...fields,
      }),
    );
  } catch {
    // never break a turn for logging
  }
}
