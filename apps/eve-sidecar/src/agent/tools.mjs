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
      description:
        'Read a UTF-8 text file under /workspace (prefer /workspace/.wellread/extract/<bookId>/).',
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
      description:
        'Write UTF-8 text under /workspace/.wellread/ only (notes paths). Overwrites existing files.',
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
      description: 'Glob files under /workspace/.wellread/ only.',
      inputSchema: z.object({
        pattern: z.string().describe('Glob pattern, e.g. /workspace/.wellread/extract/<bookId>/**/*.md'),
      }),
      execute: async ({ pattern }) => {
        const hits = globWellread(options.getBooksRoot(), pattern);
        return { hits };
      },
    }),

    grep: tool({
      description: 'Grep file contents under /workspace/.wellread/ only.',
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
