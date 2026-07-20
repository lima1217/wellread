/**
 * System prompt + source extraction for the Reading Assistant agent.
 * Kept in sidecar so the model loop does not depend on the frontend bundle.
 */

/**
 * @param {{ bookId: string, bookTitle?: string | null }} input
 */
export function buildSystemPrompt(input) {
  const title = (input.bookTitle || '').trim() || input.bookId;
  const extractRoot = `/workspace/.wellread/extract/${input.bookId}/`;
  const notesRoot = `/workspace/.wellread/notes/${input.bookId}/`;
  return [
    'You are the Reading Assistant for wellread — a desktop ebook reader.',
    `Current book: "${title}" (bookId=${input.bookId}).`,
    `Stay on the current book only. Prefer materials under ${extractRoot}.`,
    'You may use glob, grep, and read_file on that extract tree when helpful; do not read epub/pdf binaries as text.',
    'Grounding is optional: answer freely when you already know enough; cite book locations when you reference specific passages.',
    'When citing a passage, prefer sources with cfi (and optional endCfi/title) from chunk frontmatter so the reader can jump back.',
    `write_file only when the user explicitly asks to save/write/store something. Use fixed paths under ${notesRoot} (e.g. summary.md, outline.md, chapters/<slug>.md) and overwrite in place. Do not write otherwise; do not ask for confirmation.`,
    'Match the user language (Chinese question → Chinese answer).',
    'Do not pretend to have skills that are not mounted (translation pipelines, wiki packs, cross-book search).',
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
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      try {
        return JSON.parse(`"${raw.slice(1, -1).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
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
