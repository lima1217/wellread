/**
 * Pure helpers for Reading Assistant v1 (issue #7 / assets 08).
 */

export type ReadingAssistantGate = {
  modelEnabled: boolean;
  sidecarReady: boolean;
  /** Valid `activeProfileId` that resolves to a profile row. */
  hasActiveProfile: boolean;
  /** Non-empty keychain apiKey for the active profile. */
  hasApiKey: boolean;
};

/** AI available = enabled + sidecar ready + valid active profile + that profile's key. */
export function isReadingAssistantAvailable(gate: ReadingAssistantGate): boolean {
  return gate.modelEnabled && gate.sidecarReady && gate.hasActiveProfile && gate.hasApiKey;
}

export type PendingQuoteForTurn = {
  text: string;
  chapterTitle?: string | null;
};

/**
 * Wire content for an eve turn: Pending Quote blockquotes + user question.
 * Composer stays quote-free; this is only what the model receives.
 */
export function formatPendingQuotesForTurn(
  quotes: PendingQuoteForTurn[],
  userText: string,
): string {
  const question = userText.trim();
  const blocks = quotes
    .map((q) => {
      const text = q.text.trim();
      if (!text) return '';
      const lines = [`> ${text}`];
      const chapter = q.chapterTitle?.trim();
      if (chapter) {
        lines.push(`> — 《${chapter}》`);
      }
      return lines.join('\n');
    })
    .filter(Boolean);
  return [...blocks, question].filter(Boolean).join('\n\n');
}

export type SourceItem = {
  cfi: string;
  endCfi?: string;
  title?: string;
  path?: string;
};

/** Parse 09-style chunk markdown frontmatter into source items. */
export function extractSourcesFromChunkMarkdown(markdown: string, path?: string): SourceItem[] {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  const block = match[1]!;
  const get = (key: string): string | undefined => {
    const m = block.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    if (!m) return undefined;
    const raw = m[1]!.trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      try {
        return JSON.parse(
          `"${raw.slice(1, -1).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
        ) as string;
      } catch {
        return raw.slice(1, -1);
      }
    }
    return raw || undefined;
  };
  const cfi = get('cfi');
  if (!cfi) return [];
  const endCfi = get('endCfi');
  const title = get('title');
  return [
    {
      cfi,
      ...(endCfi ? { endCfi } : {}),
      ...(title ? { title } : {}),
      ...(path ? { path } : {}),
    },
  ];
}

export type ToolTraceEntry = { name: string };

/** Always-visible T3 summary line for tool traces (expand shows params). */
export function summarizeToolTrace(tools: ToolTraceEntry[]): string {
  const n = tools.length;
  if (n === 0) return '';
  // English key-as-content; UI may pass through useTranslation.
  return `Searched extract · ${n} ${n === 1 ? 'step' : 'steps'}`;
}

/**
 * Show the pending-reply dots only while the *current* turn has no assistant text.
 * Prior assistant messages in the session must not suppress later waits.
 * Reasoning-only bubbles (Think mode) still count as a visible reply cue.
 */
export function shouldShowPendingReply(
  busy: boolean,
  messages: ReadonlyArray<{ role: string; content: string; reasoning?: string }>,
): boolean {
  if (!busy) return false;
  const last = messages[messages.length - 1];
  if (!last) return true;
  if (last.role === 'assistant') {
    if (last.content.trim().length > 0) return false;
    if ((last.reasoning ?? '').trim().length > 0) return false;
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
