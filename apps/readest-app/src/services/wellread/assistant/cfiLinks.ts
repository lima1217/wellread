/**
 * EPUB CFI citation helpers for Reading Assistant markdown.
 */

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

/** Markdown link `[label](<dest>)` or `[label](dest)` with one level of nested parens. */
const MD_LINK = /(!?)\[([^\]\n]*)\]\((<[^>\n]*>|[^()\s]*(?:\([^()\n]*\)[^()\s]*)*)\)/g;
/** After a citation: end, newline, closing punctuation, or another link. */
const CITATION_END_AFTER = /^\s*(?:$|\n|[，。；：！？、,.;:!?）)\]」』"”’'*_]|\[)/;
/** Before a citation: start, newline, or sentence-ending punctuation. */
const CITATION_END_BEFORE = /(?:^|\n|[。；！？.;!?])\s*$/;

function isPlaceholderCitationLabel(label: string): boolean {
  const t = label.trim();
  return !t || /^passage$/i.test(t) || /^source\s+\d+$/i.test(t) || /epubcfi\(/i.test(t);
}

/**
 * Rewrite in-book citation links (epubcfi / extract chunk hrefs). `inline` is
 * true when the link reads as part of the sentence (在[第三章](…)中) rather than
 * a trailing citation marker. Fenced and inline code are left untouched.
 */
function rewriteCitationLinks(
  markdown: string,
  rewrite: (m: { raw: string; label: string; href: string; inline: boolean }) => string,
): string {
  const slots: string[] = [];
  const stash = (m: string) => {
    slots.push(m);
    return `${LINKIFY_SLOT}${slots.length - 1}${LINKIFY_SLOT}`;
  };
  const text = markdown.replace(/```[\s\S]*?```/g, stash).replace(/`[^`\n]+`/g, stash);
  const out = text.replace(
    MD_LINK,
    (raw, bang: string, label: string, dest: string, offset: number, whole: string) => {
      const href = dest.replace(/^<|>$/g, '');
      if (bang || !isAssistantSourceHref(href)) return raw;
      const before = whole.slice(0, offset);
      const after = whole.slice(offset + raw.length);
      const inline =
        !isPlaceholderCitationLabel(label) &&
        !CITATION_END_AFTER.test(after) &&
        !CITATION_END_BEFORE.test(before);
      return rewrite({ raw, label: label.trim(), href, inline });
    },
  );
  return out.replace(
    new RegExp(`${LINKIFY_SLOT}(\\d+)${LINKIFY_SLOT}`, 'g'),
    (_m, i: string) => slots[Number(i)]!,
  );
}

/**
 * For display: when a citation link is part of the sentence, keep its label as
 * prose so the rendered citation marker does not swallow words.
 */
export function markInlineCitations(markdown: string): string {
  if (!markdown) return markdown;
  return rewriteCitationLinks(markdown, (m) => (m.inline ? `${m.label}${m.raw}` : m.raw));
}

export type AssistantCitation = { cfi: string; title: string };

/** Unique in-book citations of an assistant reply, in first-appearance order. */
export function collectAssistantCitations(
  markdown: string,
  sources?: EveSourceLike[],
  fallbackLabel = 'Passage',
): AssistantCitation[] {
  const seen = new Set<string>();
  const list: AssistantCitation[] = [];
  rewriteCitationLinks(linkifyBareEpubCfi(markdown, sources, fallbackLabel), (m) => {
    const source = resolveEveSource(sources, { href: m.href, label: m.label });
    if (source?.cfi && !seen.has(cfiIdentity(source.cfi))) {
      seen.add(cfiIdentity(source.cfi));
      const label = isPlaceholderCitationLabel(m.label) ? '' : m.label;
      list.push({ cfi: source.cfi, title: source.title?.trim() || label });
    }
    return m.raw;
  });
  return list;
}

/** Position of a resolved citation in `citations` (1-based), or null. */
export function citationNumber(citations: AssistantCitation[], cfi: string): number | null {
  const key = cfiIdentity(cfi);
  const i = citations.findIndex((c) => cfiIdentity(c.cfi) === key);
  return i < 0 ? null : i + 1;
}

/**
 * Text for the assistant copy button: markdown without in-book citations.
 * Trailing citation markers are dropped; a link used inside the sentence keeps
 * its label. External links and formatting stay.
 */
export function stripAssistantCfiCitations(markdown: string): string {
  if (!markdown) return markdown;

  let text = rewriteCitationLinks(linkifyBareEpubCfi(markdown), (m) => (m.inline ? m.label : ''));

  // Leftover bare epubcfi(...) (e.g. inside inline code that is not cfi-only).
  text = text.replace(/epubcfi\([^)]+\)/gi, '');

  // Citation groups emptied above: （）, (、), …
  text = text.replace(/[（(][\s、,，;；]*[）)]/g, '');
  text = text.replace(/[^\S\n]{2,}/g, ' ');
  text = text.replace(/ *([，。；！？、,.!?])/g, '$1');
  text = text.replace(/([（(]) +/g, '$1').replace(/ +([）)])/g, '$1');
  text = text.replace(/ *\n[^\S\n]*/g, '\n');
  return text.trim();
}
