/**
 * Reading-assistant tools over Books FS (read/write/glob/grep).
 */

import { tool } from 'ai';
import { z } from 'zod';
import { createBooksFsSession, globWellread, grepWellread } from '../books/index.mjs';

/** Cap grep hits returned to the model (passed through as search maxHits). */
export const GREP_MODEL_HIT_MAX = 40;

/** Truncate each grep line text for token density. */
export const GREP_LINE_TEXT_MAX = 160;

/**
 * Compact extract-chunk markdown for the model: keep cfi/title (+ endCfi)
 * frontmatter, drop bookId/sectionIndex/chunkIndex noise.
 * @param {string} content
 * @returns {string}
 */
export function projectExtractContentForModel(content) {
  if (typeof content !== 'string') return content;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return content;
  const block = match[1];
  const body = match[2] ?? '';
  const get = (key) => {
    const m = block.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    return m ? m[1].trim() : undefined;
  };
  const cfi = get('cfi');
  if (!cfi) return content;
  const title = get('title');
  const endCfi = get('endCfi');
  const lines = ['---', `cfi: ${cfi}`];
  if (title !== undefined) lines.push(`title: ${title}`);
  if (endCfi !== undefined) lines.push(`endCfi: ${endCfi}`);
  lines.push('---', '', body.replace(/^\r?\n/, ''));
  return lines.join('\n');
}

/**
 * @param {{ path: string, line: number, text: string }} hit
 */
export function projectGrepHitForModel(hit) {
  let text = typeof hit.text === 'string' ? hit.text : '';
  if (text.length > GREP_LINE_TEXT_MAX) {
    text = `${text.slice(0, GREP_LINE_TEXT_MAX - 1).trimEnd()}…`;
  }
  return { path: hit.path, line: hit.line, text };
}

/**
 * @param {{ getBooksRoot: () => string }} options
 */
export function createReadingTools(options) {
  const session = createBooksFsSession({ getBooksRoot: options.getBooksRoot });

  return {
    read_file: tool({
      description:
        'Read UTF-8 text at an absolute /workspace path (extract chunks, or /workspace/skills/<id>/SKILL.md).',
      inputSchema: z.object({
        path: z.string().describe('Absolute workspace path starting with /workspace'),
      }),
      execute: async ({ path }) => {
        const bytes = await session.readFile({ path });
        if (bytes === null) return { path, content: null, error: 'not_found' };
        const raw = new TextDecoder('utf-8').decode(bytes);
        return { path, content: projectExtractContentForModel(raw) };
      },
    }),

    write_file: tool({
      description: 'Write UTF-8 notes under /workspace/.wellread/ (overwrite).',
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async ({ path, content }) => {
        await session.writeFile({
          path,
          content: new TextEncoder().encode(content),
        });
        return { path, ok: true };
      },
    }),

    glob: tool({
      description: 'Find extract/notes paths under /workspace/.wellread/.',
      inputSchema: z.object({
        pattern: z.string().describe('Glob pattern, e.g. /workspace/.wellread/extract/<bookId>/**/*.md'),
      }),
      execute: async ({ pattern }) => {
        const hits = globWellread(options.getBooksRoot(), pattern);
        return { hits };
      },
    }),

    grep: tool({
      description: 'Search extract/notes text under /workspace/.wellread/.',
      inputSchema: z.object({
        pattern: z.string(),
        path: z.string().optional(),
        regex: z.boolean().optional(),
      }),
      execute: async ({ pattern, path, regex }) => {
        const hits = grepWellread(options.getBooksRoot(), pattern, {
          path,
          regex: regex !== false,
          maxHits: GREP_MODEL_HIT_MAX,
        });
        return { hits: hits.map(projectGrepHitForModel) };
      },
    }),
  };
}
