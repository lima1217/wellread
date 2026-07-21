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

const CHAPTER_ATTR = /^— 《(.+)》$/;

/**
 * Inverse of formatPendingQuotesForTurn: recover QuoteStack fields from disk wire text.
 */
export function parsePendingQuotesFromWire(wire: string): {
  quotes: Array<{ text: string; chapterTitle: string | null }>;
  content: string;
} {
  const trimmed = wire.trim();
  if (!trimmed) return { quotes: [], content: '' };

  const parts = trimmed.split(/\n\n+/);
  const quotes: Array<{ text: string; chapterTitle: string | null }> = [];
  let i = 0;
  for (; i < parts.length; i++) {
    const block = parts[i]!.trim();
    if (!block) continue;
    const lines = block.split('\n');
    if (!lines.every((line) => line.startsWith('>'))) break;

    let chapterTitle: string | null = null;
    const textLines: string[] = [];
    for (const line of lines) {
      const body = line.replace(/^>\s?/, '');
      const chapterMatch = CHAPTER_ATTR.exec(body);
      if (chapterMatch) {
        chapterTitle = chapterMatch[1] ?? null;
      } else {
        textLines.push(body);
      }
    }
    const text = textLines.join('\n').trim();
    if (text) quotes.push({ text, chapterTitle });
  }

  const content = parts.slice(i).join('\n\n').trim();
  return { quotes, content: content || (quotes.length ? '' : trimmed) };
}

export type HydrateableEveMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  quotes?: Array<{ text: string; chapterTitle?: string | null }>;
  [key: string]: unknown;
};

/**
 * Disk sessions store model wire text (blockquote quotes). Live UI keeps quotes
 * separate — rehydrate so Chat History matches the in-session bubble.
 */
export function hydrateEveMessagesForDisplay<T extends HydrateableEveMessage>(messages: T[]): T[] {
  return messages.map((msg) => {
    if (msg.role !== 'user') return msg;
    if (msg.quotes?.length) return msg;
    const { quotes, content } = parsePendingQuotesFromWire(msg.content);
    if (!quotes.length) return msg;
    return { ...msg, content, quotes };
  });
}

export type ToolTraceEntry = { name: string };

/** Always-visible T3 summary line for tool traces (expand shows params). */
export function summarizeToolTrace(tools: ToolTraceEntry[]): string {
  const n = tools.length;
  if (n === 0) return '';
  const onlyWrites = tools.every((t) => t.name === 'write_file');
  const label = onlyWrites ? 'Saved notes' : 'Searched extract';
  // English key-as-content; UI may pass through useTranslation.
  return `${label} · ${n} ${n === 1 ? 'step' : 'steps'}`;
}

export type EveSourceLike = {
  cfi: string;
  endCfi?: string;
  title?: string;
  path?: string;
};

/** Href that should jump in-reader (extract chunk path or epubcfi), not open as a URL. */
export function isAssistantSourceHref(href: string | null | undefined): boolean {
  if (!href) return false;
  const h = href.trim();
  if (!h) return false;
  if (/epubcfi\(/i.test(h)) return true;
  if (/(^|\/)chunks\/[^/?#]+\.md(?:[?#]|$)/i.test(h)) return true;
  if (/\.wellread\/extract\//i.test(h)) return true;
  return false;
}

/** Absolute http(s) only — relative/file/workspace hrefs must not open a new window. */
export function isExternalHttpHref(href: string | null | undefined): boolean {
  if (!href) return false;
  try {
    const u = new URL(href.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function extractEpubCfi(text: string): string | null {
  const m = text.match(/epubcfi\([^)]+\)/i);
  return m ? m[0] : null;
}

function hrefFileName(href: string): string {
  const noQuery = href.split(/[?#]/)[0] ?? href;
  const parts = noQuery.split('/');
  return parts[parts.length - 1] || '';
}

/**
 * Map a markdown citation (chunk link / Section label / bare cfi) onto tool-collected sources.
 * Bare epubcfi hrefs remain navigable even when sources is empty.
 */
export function resolveEveSource(
  sources: EveSourceLike[] | undefined,
  opts: { href?: string | null; label?: string | null },
): EveSourceLike | null {
  const href = opts.href?.trim() ?? '';
  const label = opts.label?.trim() ?? '';
  const list = sources ?? [];

  const cfiFromHref = href ? extractEpubCfi(href) : null;
  if (cfiFromHref) {
    const hit = list.find((s) => s.cfi === cfiFromHref);
    return hit ?? { cfi: cfiFromHref };
  }

  if (href) {
    const file = hrefFileName(href);
    if (file) {
      const byPath = list.find((s) => {
        if (!s.path) return false;
        return s.path === href || s.path.endsWith(`/${file}`) || s.path.endsWith(file);
      });
      if (byPath) return byPath;
    }
  }

  if (label) {
    const exact = list.find((s) => s.title?.trim() === label);
    if (exact) return exact;
    const loose = list.find((s) => {
      const t = s.title?.trim();
      if (!t) return false;
      return label.includes(t) || t.includes(label);
    });
    if (loose) return loose;
  }

  return null;
}

export function formatEveSourceLabel(source: EveSourceLike, index: number): string {
  const title = source.title?.trim();
  if (title) return title;
  return `Source ${index + 1}`;
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
