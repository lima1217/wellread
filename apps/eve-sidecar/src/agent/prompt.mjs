/**
 * System prompt + source extraction for the Reading Assistant agent.
 * Kept in sidecar so the model loop does not depend on the frontend bundle.
 */

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
