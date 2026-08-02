/**
 * System prompt + reading-context envelope for the Reading Assistant agent.
 * Kept in sidecar so the model loop does not depend on the frontend bundle.
 */

import {
  ENVELOPE_KEYS,
  normalizeReaderState as normalizeReaderStateShared,
} from '@wellread/reading-context';
import { CFI_COMPARE_MAX_LENGTH } from './epubcfiCompare.mjs';
import {
  FOCUS_CHUNKS_MAX,
  SECTION_CHUNKS_ASK_THRESHOLD,
} from './resolveSectionChunks.mjs';

/** Max prior CFI sources replayed into the reading-context envelope. */
export const PRIOR_SOURCES_MAX = 12;

/**
 * Optional client reading position for the reading-context envelope.
 * Field names live in @wellread/reading-context; CFI length matches epubcfiCompare.
 *
 * @param {unknown} raw
 * @returns {{ chapter?: string, cfi?: string, sectionIndex?: number } | null}
 */
export function normalizeReaderState(raw) {
  return normalizeReaderStateShared(raw, { cfiMaxLength: CFI_COMPARE_MAX_LENGTH });
}

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
    `Extract: ${extractRoot} — UTF-8 text of this book: toc.md, section-index.json, chunks/*.md (frontmatter: title, sectionIndex, chunkIndex, cfi, endCfi), meta.json. Tools: resolve_section, read_file, grep, glob. Not epub/pdf binaries.`,
    "Grounding is optional: answer freely when you already know enough; search the extract when you need this book's text; cite locations when you reference specific passages.",
    'Locate extract text without listing the whole tree:',
    '- Quotes in <reading_context> are the primary target when present.',
    '- For "this page / current position / this passage": read_file focus_chunks only (do not read all section_chunks).',
    '- For "this chapter / whole section" or when focus_chunks is empty: use section_chunks paths in order, or resolve_section(sectionIndex and/or title) then read_file — never glob extract/**/chunks/*.md to discover a section.',
    `- If section_chunk_count > ${SECTION_CHUNKS_ASK_THRESHOLD} (or section_chunks_note asks), report the count and ask before reading all.`,
    '- If extract_status is missing: say extract is unavailable; do not empty-loop with glob/grep.',
    '- If extract_status is stale: tools still work (index may be missing — prefer resolve_section / scan paths); do not claim extract is broken.',
    '- Use grep for phrase search; use glob for notes paths, not section discovery.',
    `Notes: ${notesRoot} — this book's notes wiki (OKF tree: index.md, log.md, sources|chapters|concepts|frameworks|claims|glossary|questions). Read with glob/grep/read_file; write_file only on an explicit user ask to save; overwrite in place; no confirmation prompts. AGENTS.md and tools/validators live under /workspace/skills/note/ (read-only); do not write_file them into notes.`,
    'When you cite a passage, write a markdown link: [section title](<epubcfi(...)>) using the full chunk frontmatter cfi including the epubcfi(…) wrapper (angle brackets required). Never write bare paths like cfi: /6/… and never wrap cfi in backticks — the reader jumps from the link.',
    "Reply in the user's language. Plain prose only — no emoji.",
    'Do not narrate tool use or search progress in the reply; write only the final answer.',
    'Answer with mounted tools only; translation pipelines, wiki packs, and cross-book search are unavailable until mounted.',
  ];
  const catalog = formatSkillsCatalog(input.skills);
  if (catalog) lines.push(catalog);
  return lines.join('\n');
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
 * Compact reading-domain state for the model (appended to system).
 * Omits empty sections; position is client-reported and may be stale.
 *
 * @param {{
 *   bookId: string,
 *   bookTitle?: string | null,
 *   readerState?: { chapter?: string | null, cfi?: string | null, sectionIndex?: number | null } | null,
 *   quotes?: Array<{ text: string, chapterTitle?: string | null }> | null,
 *   priorSources?: Array<{ cfi: string, title?: string, path?: string }> | null,
 *   notesIndex?: string[] | null,
 *   extractStatus?: { status: string, chunkCount?: number } | null,
 *   focusChunks?: {
 *     paths: string[],
 *     count: number,
 *     via: 'cfi' | 'section_mid' | 'none' | null,
 *   } | null,
 *   sectionChunks?: {
 *     paths: string[],
 *     count: number,
 *     via: 'sectionIndex' | 'title' | null,
 *     sectionIndex?: number,
 *     title?: string,
 *   } | null,
 * }} input
 * @returns {string | null}
 */
export function buildReadingContextEnvelope(input) {
  const title = (input.bookTitle || '').trim() || input.bookId;
  /** @type {string[]} */
  const K = ENVELOPE_KEYS;
  const body = [
    `${K.book}: ${JSON.stringify(title)}`,
    `${K.bookId}: ${JSON.stringify(input.bookId)}`,
  ];

  const extractStatus = input.extractStatus;
  if (extractStatus && typeof extractStatus.status === 'string' && extractStatus.status) {
    body.push(`${K.extractStatus}: ${extractStatus.status}`);
    if (
      typeof extractStatus.chunkCount === 'number' &&
      Number.isFinite(extractStatus.chunkCount)
    ) {
      body.push(
        `${K.extractChunkCount}: ${Math.max(0, Math.floor(extractStatus.chunkCount))}`,
      );
    }
  }

  const position = normalizeReaderState(input.readerState);
  if (position) {
    body.push(`${K.position}: (client-reported, may be stale)`);
    if (position.chapter) {
      body.push(`  ${K.chapter}: ${JSON.stringify(position.chapter)}`);
    }
    if (position.cfi) body.push(`  ${K.cfi}: ${JSON.stringify(position.cfi)}`);
    if (position.sectionIndex !== undefined) {
      body.push(`  ${K.sectionIndex}: ${position.sectionIndex}`);
    }
  }

  const focusChunks = input.focusChunks;
  const focusPaths =
    focusChunks && Array.isArray(focusChunks.paths)
      ? focusChunks.paths
          .filter((p) => typeof p === 'string' && p.trim())
          .slice(0, FOCUS_CHUNKS_MAX)
      : [];
  if (focusChunks && focusChunks.via && focusChunks.via !== 'none') {
    body.push(`${K.focusChunksVia}: ${focusChunks.via}`);
    body.push(`${K.focusChunkCount}: ${focusPaths.length}`);
    if (focusPaths.length) {
      body.push(`${K.focusChunks}:`);
      for (const p of focusPaths) {
        body.push(`  - ${JSON.stringify(p.trim())}`);
      }
    } else {
      body.push(`${K.focusChunks}: (none matched)`);
    }
  }

  const sectionChunks = input.sectionChunks;
  const chunkPaths =
    sectionChunks && Array.isArray(sectionChunks.paths)
      ? sectionChunks.paths.filter((p) => typeof p === 'string' && p.trim())
      : [];
  const chunkCount =
    sectionChunks && typeof sectionChunks.count === 'number' && sectionChunks.count >= 0
      ? sectionChunks.count
      : chunkPaths.length;
  if (sectionChunks && sectionChunks.via) {
    body.push(`${K.sectionChunksVia}: ${sectionChunks.via}`);
    body.push(`${K.sectionChunkCount}: ${chunkCount}`);
    if (chunkCount > SECTION_CHUNKS_ASK_THRESHOLD) {
      body.push(
        `${K.sectionChunksNote}: ${chunkCount} chunks (>${SECTION_CHUNKS_ASK_THRESHOLD}); report count and ask before reading all`,
      );
    }
    if (chunkPaths.length) {
      body.push(`${K.sectionChunks}:`);
      for (const p of chunkPaths) {
        body.push(`  - ${JSON.stringify(p.trim())}`);
      }
    } else {
      body.push(
        `${K.sectionChunks}: (none matched — extract missing, stale position, or title mismatch)`,
      );
    }
  }

  const quotes = Array.isArray(input.quotes) ? input.quotes : [];
  const quoteLines = [];
  for (const q of quotes) {
    if (!q || typeof q.text !== 'string') continue;
    const text = q.text.trim();
    if (!text) continue;
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
    body.push(`${K.quotes}:`);
    body.push(...quoteLines);
  }

  const priors = Array.isArray(input.priorSources) ? input.priorSources : [];
  if (priors.length) {
    body.push(`${K.priorSources}:`);
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
      `${K.notesIndex}: ${notes.map((n) => JSON.stringify(n.trim())).join(', ')}`,
    );
  }

  // book/bookId alone are already in the base system prompt — skip empty envelope.
  const hasExtra =
    Boolean(position) ||
    Boolean(extractStatus?.status) ||
    Boolean(focusChunks?.via && focusChunks.via !== 'none') ||
    Boolean(sectionChunks?.via) ||
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
