/**
 * Small UI/session helpers for Reading Assistant chat.
 */

/**
 * Show the pending-reply dots only while the *current* turn has no visible
 * assistant activity. Reasoning, tools, or text each count as a visible cue.
 */
export function shouldShowPendingReply(
  busy: boolean,
  messages: ReadonlyArray<{
    role: string;
    content: string;
    reasoning?: string;
    tools?: unknown[];
    parts?: unknown[];
  }>,
): boolean {
  if (!busy) return false;
  const last = messages[messages.length - 1];
  if (!last) return true;
  if (last.role === 'assistant') {
    if (last.content.trim().length > 0) return false;
    if ((last.reasoning ?? '').trim().length > 0) return false;
    if ((last.tools?.length ?? 0) > 0) return false;
    if ((last.parts?.length ?? 0) > 0) return false;
  }
  return true;
}

/** Compact duration for assistant footer metadata (e.g. "12s", "2m 5s"). */
export function formatWorkDuration(ms: number): string {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/**
 * Whether to write agent.sessionId into the reading-assistant store.
 *
 * Only push when the agent itself acquired a new id (lazy create on first send).
 * New chat clears the store first while agent state is still stale for one paint —
 * pushing that stale id would restore the session we just left.
 */
export function shouldPushAgentSessionToStore(input: {
  agentSessionId: string | null;
  previousAgentSessionId: string | null | undefined;
  storeSessionId: string | null;
  storeBookId: string | null;
  bookId: string;
}): boolean {
  const { agentSessionId, previousAgentSessionId, storeSessionId, storeBookId, bookId } = input;
  if (!agentSessionId) return false;
  if (previousAgentSessionId === agentSessionId) return false;
  return agentSessionId !== storeSessionId || storeBookId !== bookId;
}
