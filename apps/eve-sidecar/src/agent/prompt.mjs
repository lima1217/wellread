/**
 * System prompt + source extraction for the Reading Assistant agent.
 * Kept in sidecar so the model loop does not depend on the frontend bundle.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** Max prior CFI sources replayed into the reading-context envelope. */
export const PRIOR_SOURCES_MAX = 12;

/** Max note file paths listed in the envelope (names only). */
export const NOTES_INDEX_MAX = 24;

/** Max chars per Pending Quote text in the envelope. */
export const ENVELOPE_QUOTE_TEXT_MAX = 500;

const CHAPTER_ATTR = /^— 《(.+)》$/;

/**
 * @param {{
 *   bookId: string,
 *   bookTitle?: string | null,
 *   skills?: Array<{ id: string, name: string, description: string, path: string }>,
 * }} input
 */
export function buildSystemPrompt(input) {
  const title = (input.bookTitle || '').trim() || input.bookId;
  const extractRoot = `/workspace/.wellread/extract/${input.bookId}/`;
  const notesRoot = `/workspace/.wellread/notes/${input.bookId}/`;
  const lines = [
    "You are wellread's Reading Assistant — scoped to the current book only.",
    `Current book: "${title}" (bookId=${input.bookId}).`,
    `Extract: ${extractRoot} — you may use glob, grep, and read_file on that tree when helpful; UTF-8 extract text only (not epub/pdf binaries).`,
    "Grounding is optional: answer freely when you already know enough; search the extract when you need this book's text; cite locations when you reference specific passages.",
    `Notes: ${notesRoot} — write_file only on an explicit user ask to save; use fixed paths (summary.md, outline.md, chapters/<slug>.md) and overwrite in place; no confirmation prompts.`,
    'When you cite a passage, write a markdown link: [section title](<epubcfi(...)>) using the full chunk frontmatter cfi including the epubcfi(…) wrapper (angle brackets required). Never write bare paths like cfi: /6/… and never wrap cfi in backticks — the reader jumps from the link.',
    "Reply in the user's language. Plain prose only — no emoji.",
    'Answer with mounted tools only; translation pipelines, wiki packs, and cross-book search are unavailable until mounted.',
  ];
  const catalog = formatSkillsCatalog(input.skills);
  if (catalog) lines.push(catalog);
  return lines.join('\n');
}

/**
 * Split leading Pending Quote `> …` blocks from the trailing question.
 * Quote parts keep original wire segments (for skill expand reassembly).
 * @param {string} wire
 * @returns {{ quoteParts: string[], content: string }}
 */
export function peelLeadingQuoteWire(wire) {
  const trimmed = typeof wire === 'string' ? wire.trim() : '';
  if (!trimmed) return { quoteParts: [], content: '' };
  if (!trimmed.startsWith('>')) return { quoteParts: [], content: trimmed };

  const parts = trimmed.split(/\n\n+/);
  /** @type {string[]} */
  const quoteParts = [];
  let i = 0;
  for (; i < parts.length; i++) {
    const block = (parts[i] || '').trim();
    if (!block) continue;
    const lines = block.split('\n');
    if (!lines.every((line) => line.startsWith('>'))) break;
    quoteParts.push(parts[i]);
  }

  const content = parts.slice(i).join('\n\n').trim();
  return {
    quoteParts,
    content: content || (quoteParts.length ? '' : trimmed),
  };
}

/**
 * Peel leading Pending Quote blockquotes from wire text (mirrors client helper).
 * @param {string} wire
 * @returns {{
 *   quotes: Array<{ text: string, chapterTitle: string | null }>,
 *   content: string,
 * }}
 */
export function parsePendingQuotesFromWire(wire) {
  const { quoteParts, content } = peelLeadingQuoteWire(wire);
  /** @type {Array<{ text: string, chapterTitle: string | null }>} */
  const quotes = [];
  for (const part of quoteParts) {
    const block = (part || '').trim();
    if (!block) continue;
    const lines = block.split('\n');
    /** @type {string | null} */
    let chapterTitle = null;
    /** @type {string[]} */
    const textLines = [];
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
  return { quotes, content };
}

/**
 * Strip leading Pending Quote blocks so quotes live only in the envelope.
 * @param {string} message
 */
export function stripLeadingQuoteBlocks(message) {
  return peelLeadingQuoteWire(message).content;
}

/**
 * Dedupe recent assistant.sources (newest first) for cross-turn continuity.
 * @param {Array<{ role?: string, sources?: Array<{ cfi?: string, title?: string, path?: string }> }>} messages
 * @param {number} [max]
 * @returns {Array<{ cfi: string, title?: string, path?: string }>}
 */
export function collectPriorSources(messages, max = PRIOR_SOURCES_MAX) {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : PRIOR_SOURCES_MAX;
  /** @type {Array<{ cfi: string, title?: string, path?: string }>} */
  const out = [];
  const seen = new Set();
  if (!Array.isArray(messages)) return out;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'assistant' || !Array.isArray(m.sources)) continue;
    for (let j = m.sources.length - 1; j >= 0; j--) {
      const src = m.sources[j];
      if (!src || typeof src.cfi !== 'string' || !src.cfi.trim()) continue;
      const cfi = src.cfi.trim();
      if (seen.has(cfi)) continue;
      seen.add(cfi);
      out.push({
        cfi,
        ...(typeof src.title === 'string' && src.title.trim()
          ? { title: src.title.trim() }
          : {}),
        ...(typeof src.path === 'string' && src.path.trim()
          ? { path: src.path.trim() }
          : {}),
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * bookId must be a single path segment (no separators / traversal).
 * @param {unknown} bookId
 */
export function isSafeBookIdSegment(bookId) {
  if (typeof bookId !== 'string' || !bookId) return false;
  if (bookId !== bookId.trim()) return false;
  if (bookId === '.' || bookId === '..') return false;
  if (/[/\\]/.test(bookId)) return false;
  if (/[\r\n\u0000]/.test(bookId)) return false;
  return true;
}

/**
 * List note file paths relative to the book notes root (names only, no body).
 * @param {string} booksRoot
 * @param {string} bookId
 * @param {number} [max]
 * @returns {string[]}
 */
export function listNotesIndex(booksRoot, bookId, max = NOTES_INDEX_MAX) {
  if (!booksRoot || !isSafeBookIdSegment(bookId)) return [];
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : NOTES_INDEX_MAX;
  const notesBase = resolve(join(booksRoot, '.wellread', 'notes'));
  const root = resolve(join(notesBase, bookId));
  if (root !== notesBase && !root.startsWith(`${notesBase}${sep}`)) return [];
  /** @type {string[]} */
  const files = [];
  try {
    walkNotes(root, root, files, limit);
  } catch {
    return [];
  }
  return files;
}

/**
 * @param {string} dir
 * @param {string} root
 * @param {string[]} out
 * @param {number} limit
 */
function walkNotes(dir, root, out, limit) {
  if (out.length >= limit) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    if (out.length >= limit) return;
    if (ent.name.startsWith('.')) continue;
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      walkNotes(abs, root, out, limit);
      continue;
    }
    if (!ent.isFile()) continue;
    try {
      if (!statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    const rel = relative(root, abs).split('\\').join('/');
    // Skip traversal escapes and control chars that would break envelope lines.
    if (!rel || rel.startsWith('..') || /[\r\n\u0000]/.test(rel)) continue;
    out.push(rel);
  }
}

/**
 * Compact reading-domain state for the model (appended to system).
 * Omits empty sections; position is client-reported and may be stale.
 *
 * @param {{
 *   bookId: string,
 *   bookTitle?: string | null,
 *   readerState?: { chapter?: string | null, cfi?: string | null } | null,
 *   quotes?: Array<{ text: string, chapterTitle?: string | null }> | null,
 *   priorSources?: Array<{ cfi: string, title?: string, path?: string }> | null,
 *   notesIndex?: string[] | null,
 * }} input
 * @returns {string | null}
 */
export function buildReadingContextEnvelope(input) {
  const title = (input.bookTitle || '').trim() || input.bookId;
  /** @type {string[]} */
  const body = [
    `book: ${JSON.stringify(title)}`,
    `bookId: ${JSON.stringify(input.bookId)}`,
  ];

  const chapter =
    typeof input.readerState?.chapter === 'string'
      ? input.readerState.chapter.trim()
      : '';
  const cfi =
    typeof input.readerState?.cfi === 'string' ? input.readerState.cfi.trim() : '';
  if (chapter || cfi) {
    body.push('position: (client-reported, may be stale)');
    if (chapter) body.push(`  chapter: ${JSON.stringify(chapter)}`);
    if (cfi) body.push(`  cfi: ${JSON.stringify(cfi)}`);
  }

  const quotes = Array.isArray(input.quotes) ? input.quotes : [];
  const quoteLines = [];
  for (const q of quotes) {
    if (!q || typeof q.text !== 'string') continue;
    let text = q.text.trim();
    if (!text) continue;
    if (text.length > ENVELOPE_QUOTE_TEXT_MAX) {
      text = `${text.slice(0, ENVELOPE_QUOTE_TEXT_MAX - 1).trimEnd()}…`;
    }
    const ch =
      typeof q.chapterTitle === 'string' && q.chapterTitle.trim()
        ? q.chapterTitle.trim()
        : '';
    quoteLines.push(
      ch
        ? `  - text: ${JSON.stringify(text)} chapter: ${JSON.stringify(ch)}`
        : `  - text: ${JSON.stringify(text)}`,
    );
  }
  if (quoteLines.length) {
    body.push('quotes:');
    body.push(...quoteLines);
  }

  const priors = Array.isArray(input.priorSources) ? input.priorSources : [];
  if (priors.length) {
    body.push('prior_sources:');
    for (const s of priors) {
      if (!s?.cfi) continue;
      const label =
        typeof s.title === 'string' && s.title.trim()
          ? ` title: ${JSON.stringify(s.title.trim())}`
          : '';
      const path =
        typeof s.path === 'string' && s.path.trim()
          ? ` path: ${JSON.stringify(s.path.trim())}`
          : '';
      body.push(`  - cfi: ${JSON.stringify(s.cfi)}${label}${path}`);
    }
  }

  const notes = Array.isArray(input.notesIndex)
    ? input.notesIndex.filter((n) => typeof n === 'string' && n.trim())
    : [];
  if (notes.length) {
    body.push(
      `notes_index: ${notes.map((n) => JSON.stringify(n.trim())).join(', ')}`,
    );
  }

  // book/bookId alone are already in the base system prompt — skip empty envelope.
  const hasExtra =
    Boolean(chapter || cfi) ||
    quoteLines.length > 0 ||
    priors.length > 0 ||
    notes.length > 0;
  if (!hasExtra) return null;

  return ['<reading_context>', ...body, '</reading_context>'].join('\n');
}

/**
 * Join base system prompt with an optional reading-context envelope.
 * @param {string} systemPrompt
 * @param {string | null | undefined} envelope
 */
export function appendReadingContext(systemPrompt, envelope) {
  const env = typeof envelope === 'string' ? envelope.trim() : '';
  if (!env) return systemPrompt;
  return `${systemPrompt}\n\n${env}`;
}

/** Max length of a skill description line in the system catalog. */
export const SKILL_CATALOG_DESC_MAX = 200;

/**
 * Flatten description for system-prompt catalog: no C0/newlines, hard length cap.
 * @param {string} description
 * @returns {string}
 */
export function sanitizeSkillCatalogDescription(description) {
  if (typeof description !== 'string') return '';
  const flat = description
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= SKILL_CATALOG_DESC_MAX) return flat;
  return `${flat.slice(0, SKILL_CATALOG_DESC_MAX - 1).trimEnd()}…`;
}

/**
 * Progressive disclosure: catalog only (id + description + path). Full
 * instructions load via /skill: expansion or read_file on the skill path.
 * @param {Array<{ id: string, name?: string, description: string, path: string }> | null | undefined} skills
 * @returns {string | null}
 */
export function formatSkillsCatalog(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return null;
  const entries = [];
  for (const s of skills) {
    if (!s || typeof s.id !== 'string' || typeof s.description !== 'string' || typeof s.path !== 'string') {
      continue;
    }
    const description = sanitizeSkillCatalogDescription(s.description);
    if (!description) continue;
    entries.push(`- ${s.id}: ${description} (${s.path})`);
  }
  if (entries.length === 0) return null;
  return [
    'Available skills (read_file the SKILL.md path when continuing a prior /skill: turn or a description matches the request; /skill:<id> already expands instructions into that turn):',
    ...entries,
    "Follow a skill's instructions after /skill: expansion or after reading its file. Do not invent skills.",
  ].join('\n');
}

/**
 * @param {string} markdown
 * @param {string} [path]
 * @returns {Array<{ cfi: string, endCfi?: string, title?: string, path?: string }>}
 */
export function extractSourcesFromChunkMarkdown(markdown, path) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  const block = match[1];
  const get = (key) => {
    const m = block.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    if (!m) return undefined;
    const raw = m[1].trim();
    // Values are written with JSON.stringify (see formatChunkMarkdown).
    if (raw.startsWith('"') || raw.startsWith("'")) {
      try {
        return JSON.parse(raw);
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

/**
 * Collect sources from tool results (read_file content with frontmatter).
 * @param {Array<{ name: string, result?: unknown }>} tools
 */
export function collectSourcesFromTools(tools) {
  /** @type {Array<{ cfi: string, endCfi?: string, title?: string, path?: string }>} */
  const sources = [];
  const seen = new Set();
  for (const t of tools) {
    if (t.name !== 'read_file' || !t.result || typeof t.result !== 'object') continue;
    const result = /** @type {{ path?: string, content?: string | null }} */ (t.result);
    if (!result.content) continue;
    for (const src of extractSourcesFromChunkMarkdown(result.content, result.path)) {
      if (seen.has(src.cfi)) continue;
      seen.add(src.cfi);
      sources.push(src);
    }
  }
  return sources;
}
