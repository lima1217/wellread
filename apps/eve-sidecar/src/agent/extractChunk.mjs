/**
 * Extract-chunk frontmatter: one module owns parse / project / citation sources.
 */

/**
 * @param {string} block frontmatter body (between --- fences)
 * @param {string} key
 * @returns {string | undefined}
 */
function frontmatterValue(block, key) {
  const m = block.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
}

/**
 * @param {string} rawJsonish
 * @returns {string}
 */
function parseFrontmatterString(rawJsonish) {
  let value = rawJsonish;
  if (value.startsWith('"') || value.startsWith("'")) {
    try {
      value = JSON.parse(value);
    } catch {
      value = rawJsonish.slice(1, -1);
    }
  }
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {string} raw
 * @returns {{
 *   sectionIndex?: number,
 *   chunkIndex?: number,
 *   title?: string,
 *   cfi?: string,
 *   endCfi?: string,
 * } | null}
 */
export function parseExtractChunkFrontmatter(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const block = match[1];
  const sectionRaw = frontmatterValue(block, 'sectionIndex');
  const chunkRaw = frontmatterValue(block, 'chunkIndex');
  const titleRaw = frontmatterValue(block, 'title');
  const cfiRaw = frontmatterValue(block, 'cfi');
  const endCfiRaw = frontmatterValue(block, 'endCfi');
  /** @type {{
   *   sectionIndex?: number,
   *   chunkIndex?: number,
   *   title?: string,
   *   cfi?: string,
   *   endCfi?: string,
   * }} */
  const out = {};
  if (sectionRaw !== undefined) {
    const n = Number(sectionRaw);
    if (Number.isFinite(n) && n >= 0) out.sectionIndex = Math.floor(n);
  }
  if (chunkRaw !== undefined) {
    const n = Number(chunkRaw);
    if (Number.isFinite(n) && n >= 0) out.chunkIndex = Math.floor(n);
  }
  if (titleRaw !== undefined) {
    const title = parseFrontmatterString(titleRaw);
    if (title) out.title = title;
  }
  if (cfiRaw !== undefined) {
    const cfi = parseFrontmatterString(cfiRaw);
    if (cfi) out.cfi = cfi;
  }
  if (endCfiRaw !== undefined) {
    const endCfi = parseFrontmatterString(endCfiRaw);
    if (endCfi) out.endCfi = endCfi;
  }
  if (
    out.sectionIndex === undefined &&
    out.chunkIndex === undefined &&
    out.title === undefined &&
    out.cfi === undefined
  ) {
    return null;
  }
  return out;
}

/**
 * Compact extract-chunk markdown for the model: keep cfi/title/sectionIndex/chunkIndex
 * (+ endCfi) frontmatter; drop bookId noise.
 * @param {string} content
 * @returns {string}
 */
export function projectExtractContentForModel(content) {
  if (typeof content !== 'string') return content;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return content;
  const meta = parseExtractChunkFrontmatter(content);
  if (!meta?.cfi) return content;
  const body = match[2] ?? '';
  const lines = ['---', `cfi: ${JSON.stringify(meta.cfi)}`];
  if (meta.title !== undefined) lines.push(`title: ${JSON.stringify(meta.title)}`);
  if (meta.endCfi !== undefined) lines.push(`endCfi: ${JSON.stringify(meta.endCfi)}`);
  if (meta.sectionIndex !== undefined) lines.push(`sectionIndex: ${meta.sectionIndex}`);
  if (meta.chunkIndex !== undefined) lines.push(`chunkIndex: ${meta.chunkIndex}`);
  lines.push('---', '', body.replace(/^\r?\n/, ''));
  return lines.join('\n');
}

/**
 * @param {string} markdown
 * @param {string} [path]
 * @returns {Array<{ cfi: string, endCfi?: string, title?: string, path?: string }>}
 */
export function extractSourcesFromChunkMarkdown(markdown, path) {
  const meta = parseExtractChunkFrontmatter(markdown);
  if (!meta?.cfi) return [];
  return [
    {
      cfi: meta.cfi,
      ...(meta.endCfi ? { endCfi: meta.endCfi } : {}),
      ...(meta.title ? { title: meta.title } : {}),
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
    const result =
      /** @type {{ ok?: boolean, path?: string, content?: string | null }} */ (t.result);
    if (result.ok === false || !result.content) continue;
    for (const src of extractSourcesFromChunkMarkdown(result.content, result.path)) {
      if (seen.has(src.cfi)) continue;
      seen.add(src.cfi);
      sources.push(src);
    }
  }
  return sources;
}
