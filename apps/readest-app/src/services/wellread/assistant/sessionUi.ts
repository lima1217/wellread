/**
 * Small UI/session helpers for Reading Assistant chat.
 */

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

export type AssistantErrorKind = 'auth' | 'rateLimit' | 'context' | 'network' | 'other';

/** Bucket a turn error (often the provider's raw text) into a user-facing kind. */
export function classifyAssistantError(message: string): AssistantErrorKind {
  if (/\b40[13]\b|api[ _-]?key|unauthori[sz]ed|authenticat/i.test(message)) return 'auth';
  if (/\b429\b|rate.?limit|quota/i.test(message)) return 'rateLimit';
  if (
    /context.?length|context window|maximum context|too many tokens|prompt is too long/i.test(
      message,
    )
  )
    return 'context';
  if (
    /fetch failed|failed to fetch|load failed|network|ECONN|ENOTFOUND|ETIMEDOUT|timed? ?out|socket|not connected/i.test(
      message,
    )
  )
    return 'network';
  return 'other';
}

export type LiveActivity<Tool> = { kind: 'thinking' } | { kind: 'tool'; tool: Tool } | null;

/**
 * What the in-flight turn is doing when nothing new is streaming visibly:
 * a running tool wins; otherwise "thinking" until reply text or reasoning shows.
 */
export function liveActivity<Tool>(
  busy: boolean,
  messages: ReadonlyArray<{ role: string; content: string; reasoning?: string; tools?: unknown[] }>,
  inFlightTools: ReadonlyArray<Tool>,
): LiveActivity<Tool> {
  if (!busy) return null;
  const running = inFlightTools[inFlightTools.length - 1];
  if (running) return { kind: 'tool', tool: running };
  const last = messages[messages.length - 1];
  if (last?.role !== 'assistant') return { kind: 'thinking' };
  if (last.content.trim()) return null;
  // Reasoning streams in its own block; after finished tools, the model is thinking again.
  if ((last.reasoning ?? '').trim() && !last.tools?.length) return null;
  return { kind: 'thinking' };
}
