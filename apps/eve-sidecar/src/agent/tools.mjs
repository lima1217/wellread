/**
 * Reading-assistant tools over Books FS (read/write/glob/grep).
 */

import { tool } from 'ai';
import { z } from 'zod';
import { createBooksFsSession, globWellread, grepWellread } from '../books/index.mjs';

/**
 * @param {{ getBooksRoot: () => string }} options
 */
export function createReadingTools(options) {
  const session = createBooksFsSession({ getBooksRoot: options.getBooksRoot });

  return {
    read_file: tool({
      description: 'Read UTF-8 text at an absolute /workspace path (extract chunks).',
      inputSchema: z.object({
        path: z.string().describe('Absolute workspace path starting with /workspace'),
      }),
      execute: async ({ path }) => {
        const bytes = await session.readFile({ path });
        if (bytes === null) return { path, content: null, error: 'not_found' };
        return { path, content: new TextDecoder('utf-8').decode(bytes) };
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
        });
        return { hits };
      },
    }),
  };
}
