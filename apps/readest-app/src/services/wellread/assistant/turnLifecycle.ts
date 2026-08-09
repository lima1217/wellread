/**
 * Turn lifecycle invariants for Reading Assistant (host ↔ eve sidecar).
 *
 * Ownership cheat-sheet:
 * - Lazy session create: first send in useEveAgent (no empty POST on New chat).
 * - Mount keys: AssistantPanel keepMounted; AIAssistant keyed by bookId only
 *   (never remount on sessionId — that aborts an in-flight turn).
 * - Stop: abort the stream; do NOT reconcileFromDisk (sidecar may still flush).
 * - 409 turn_in_flight: brief retry after Stop while the prior turn releases.
 * - Disk reconcile: after stream settles / session load — not during Stop.
 */

/** Sidecar per-session mutex — race after Stop / unmount while the prior turn releases. */
export const TURN_IN_FLIGHT_RETRIES = 8;
export const TURN_IN_FLIGHT_RETRY_MS = 150;

export function isTurnInFlightError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /turn failed:\s*409\b/.test(err.message) &&
    /turn_in_flight/.test(err.message)
  );
}

/** Remount chat when the open book changes; session switches stay mounted. */
export function assistantChatRemountKey(bookId: string): string {
  return bookId;
}
