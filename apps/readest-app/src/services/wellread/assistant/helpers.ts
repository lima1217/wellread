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
  const blocks = quotes.flatMap((q) => {
    const text = q.text.trim();
    if (!text) return [];
    const lines = [`> ${text}`];
    const chapter = q.chapterTitle?.trim();
    if (chapter) {
      lines.push(`> — 《${chapter}》`);
    }
    return [lines.join('\n')];
  });
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
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // keep raw text when not URI-encoded
  }
  return normalizeEpubCfi(decoded);
}

function hrefFileName(href: string): string {
  const noQuery = href.split(/[?#]/)[0] ?? href;
  const parts = noQuery.split('/');
  return parts[parts.length - 1] || '';
}

function cfiIdentity(cfi: string): string {
  return cfi.replace(/^epubcfi\(/i, '').replace(/\)$/, '');
}

/**
 * Normalize a citation token to `epubcfi(...)`, or null if it is not a CFI.
 * Accepts `epubcfi(/6/…)`, bare `/6/…`, and optional `cfi:` / `cfi：` prefixes.
 */
export function normalizeEpubCfi(raw: string): string | null {
  let t = raw.trim();
  if (!t) return null;
  t = t.replace(/^cfi\s*[:：]\s*/i, '').trim();
  const wrapped = t.match(/^epubcfi\((.+)\)$/i);
  if (wrapped) return `epubcfi(${wrapped[1]})`;
  // Bare EPUB CFI path (models often drop the epubcfi(…) wrapper).
  if (/^\/\d+\//.test(t)) return `epubcfi(${t})`;
  // Href may still contain an epubcfi(…) substring after decode.
  const embedded = t.match(/epubcfi\([^)]+\)/i);
  if (embedded) return normalizeEpubCfi(embedded[0]);
  const bare = t.match(/\/\d+\/[^\s`）)'"<]+/);
  if (bare && /^\/\d+\//.test(bare[0])) return `epubcfi(${bare[0]})`;
  return null;
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
    const key = cfiIdentity(cfiFromHref);
    const hit = list.find((s) => cfiIdentity(s.cfi) === key);
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

const LINKIFY_SLOT = '\uE000';

/** Inner EPUB CFI path, stopping before CJK/ASCII closers or whitespace. */
const BARE_CFI_PATH = /\/\d+\/[^\s`）)'"<]+/;

/**
 * Turn bare `epubcfi(...)`, `cfi: /6/…`, and cfi-only inline code into markdown
 * links so the reader can jump in-book. Skips fenced code and existing
 * `[text](href)` links.
 *
 * Link labels never embed the raw CFI — epubcfi often contains `[id]` which
 * breaks markdown link parsing. Destinations use `<...>` so nested `()` in the
 * CFI cannot close the link early.
 */
export function linkifyBareEpubCfi(
  markdown: string,
  sources?: EveSourceLike[],
  fallbackLabel = 'Passage',
): string {
  if (!markdown) return markdown;
  if (
    !/epubcfi\(/i.test(markdown) &&
    !/\bcfi\s*[:：]/i.test(markdown) &&
    !BARE_CFI_PATH.test(markdown)
  ) {
    return markdown;
  }

  const slots: string[] = [];
  const stash = (m: string) => {
    const i = slots.length;
    slots.push(m);
    return `${LINKIFY_SLOT}${i}${LINKIFY_SLOT}`;
  };

  const toLink = (raw: string) => {
    const cfi = normalizeEpubCfi(raw);
    if (!cfi) return raw;
    const key = cfiIdentity(cfi);
    const hit = sources?.find((s) => cfiIdentity(s.cfi) === key);
    const rawLabel = hit?.title?.trim() || fallbackLabel;
    // Strip brackets so a title cannot terminate the markdown link early.
    const label = rawLabel.replace(/[\[\]]/g, '').trim() || fallbackLabel;
    return `[${label}](<${cfi}>)`;
  };

  const cfiOnlyInlineCode = /^(?:cfi\s*[:：]\s*)?(?:epubcfi\([^)]+\)|\/\d+\/[^\s`]+)$/i;

  let text = markdown.replace(/```[\s\S]*?```/g, stash);

  // `cfi: `epubcfi(...)`` / `cfi: `/6/…`` — absorb outer cfi: with the inline code.
  text = text.replace(/\bcfi\s*[:：]\s*`([^`\n]+)`/gi, (full, code: string) => {
    const m = code.trim().match(cfiOnlyInlineCode);
    if (m) return stash(toLink(m[0]!));
    return full;
  });

  // Unwrap remaining cfi-only inline code into jump links.
  text = text.replace(/`([^`\n]+)`/g, (full, code: string) => {
    const m = code.trim().match(cfiOnlyInlineCode);
    if (m) return stash(toLink(m[0]!));
    return stash(full);
  });

  text = text
    .replace(/\[([^\]]*)\]\(<[^>\n]*>\)/g, stash)
    .replace(/\[([^\]]*)\]\([^()\n]*\([^()\n]*\)[^()\n]*\)/g, stash)
    .replace(/\[([^\]]*)\]\([^)\n]+\)/g, stash);

  // cfi: epubcfi(...) or cfi: /6/… (drop the prefix so it does not linger).
  text = text.replace(/\bcfi\s*[:：]\s*(?:epubcfi\([^)]+\)|\/\d+\/[^\s`）)'"<]+)/gi, (full) =>
    stash(toLink(full)),
  );
  text = text.replace(/epubcfi\([^)]+\)/gi, (cfi) => toLink(cfi));

  return text.replace(
    new RegExp(`${LINKIFY_SLOT}(\\d+)${LINKIFY_SLOT}`, 'g'),
    (_m, i: string) => slots[Number(i)]!,
  );
}

/**
 * Plain text for the assistant copy button: drop cfi citations / jump links,
 * keep readable prose (and section titles from markdown citation links).
 */
export function stripAssistantCfiCitations(markdown: string): string {
  if (!markdown) return markdown;

  let text = markdown;

  // [label](<epubcfi(...)>) — keep meaningful labels, drop placeholder ones.
  text = text.replace(/\[([^\]]*)\]\(<epubcfi\([^>]+\)>\)/gi, (_m, label: string) => {
    const t = label.trim();
    if (!t || /^passage$/i.test(t) || /^source\s+\d+$/i.test(t)) return '';
    return t;
  });
  text = text.replace(/\[([^\]]*)\]\(epubcfi\([^)]+\)\)/gi, (_m, label: string) => {
    const t = label.trim();
    if (!t || /^passage$/i.test(t) || /^source\s+\d+$/i.test(t)) return '';
    return t;
  });

  // （cfi: …） / (cfi: …) — remove the whole citation parenthesis.
  text = text.replace(/[（(]\s*cfi\s*[:：]\s*(?:epubcfi\([^)]+\)|\/\d+\/[^）)]+?)\s*[）)]/gi, '');

  // Inline code that is only a cfi token.
  text = text.replace(/`(?:cfi\s*[:：]\s*)?(?:epubcfi\([^)]+\)|\/\d+\/[^`]+)`/gi, '');

  // Leftover bare epubcfi(...).
  text = text.replace(/epubcfi\([^)]+\)/gi, '');

  text = text.replace(/（\s*）/g, '').replace(/\(\s*\)/g, '');
  text = text.replace(/[^\S\n]{2,}/g, ' ');
  text = text.replace(/ *([，。；！？、,.!?])/g, '$1');
  text = text.replace(/([（(]) +/g, '$1').replace(/ +([）)])/g, '$1');
  text = text.replace(/ *\n[^\S\n]*/g, '\n');
  return text.trim();
}

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

/** Pi-style skill slash namespace: `/skill:<id>`. */
export const SKILL_SLASH_PREFIX = 'skill:';

/**
 * While the composer is typing a leading `/…` skill token (no args yet), return
 * the filter query. `/skill:sum` → `sum`; bare `/sum` still filters. Once a
 * space (or newline) appears, the menu closes.
 */
export function getComposerSlashQuery(composer: string): string | null {
  if (!composer.startsWith('/')) return null;
  const after = composer.slice(1);
  if (/[\s\n]/.test(after)) return null;
  const lower = after.toLowerCase();
  if (lower.startsWith(SKILL_SLASH_PREFIX)) {
    return after.slice(SKILL_SLASH_PREFIX.length);
  }
  return after;
}

/** Filter catalog by id/name/description prefix or substring (case-insensitive). */
export function filterSkillsForSlash<T extends { id: string; name: string; description: string }>(
  skills: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...skills];
  return skills.filter((s) => {
    const id = s.id.toLowerCase();
    const name = s.name.toLowerCase();
    const description = s.description.toLowerCase();
    return id.startsWith(q) || name.includes(q) || description.includes(q);
  });
}

/** Replace a leading `/partial` with `/skill:<id> ` (trailing space for optional args). */
export function applySlashSkillSelection(composer: string, skillId: string): string {
  const inserted = `/${SKILL_SLASH_PREFIX}${skillId}`;
  if (!composer.startsWith('/')) return `${inserted} `;
  const after = composer.slice(1);
  const space = after.search(/\s/);
  if (space < 0) return `${inserted} `;
  return `${inserted}${after.slice(space)}`;
}
