/**
 * Reading-assistant tools over Books FS (read/write/glob/grep).
 *
 * Tool results use a stable envelope for the model:
 *   success → { ok: true, ...payload }
 *   soft fail → { ok: false, error, message, ... }
 * Hard runtime failures are caught and mapped into the same shape when possible.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { createBooksFsSession, globWellread, grepWellread, normalizeAbsolute } from '../books/index.mjs';
import {
  OKF_NOTES_DIRS,
  OKF_NOTES_ROOT_FILES,
  isSafeBookIdSegment,
  notesPackageWorkspaceRoot,
} from './notesOkf.mjs';

export { OKF_NOTES_DIRS, OKF_NOTES_ROOT_FILES } from './notesOkf.mjs';

/** Cap model-facing grep hits (search may return more internally). */
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
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Lexical gate for write_file: current book's OKF notes package only.
 * Does not touch the filesystem — Books FS still enforces .wellread + realpath
 * under notes/<bookId>/ when confineNotesBookId is set.
 *
 * @param {string} workspacePath
 * @param {string} bookId
 * @returns {{ ok: true, path: string } | { ok: false, error: string, message: string, path?: string }}
 */
export function authorizeOkfNotesWrite(workspacePath, bookId) {
  if (!isSafeBookIdSegment(bookId)) {
    return {
      ok: false,
      error: 'invalid_args',
      message: 'write_file requires a valid session bookId',
    };
  }

  let ws;
  try {
    ws = normalizeAbsolute(
      typeof workspacePath === 'string' && workspacePath.startsWith('/')
        ? workspacePath
        : `/workspace/${workspacePath ?? ''}`,
    );
  } catch {
    return {
      ok: false,
      error: 'invalid_args',
      message: `invalid path: ${workspacePath}`,
      path: typeof workspacePath === 'string' ? workspacePath : undefined,
    };
  }

  const notesRoot = notesPackageWorkspaceRoot(bookId);
  if (!notesRoot) {
    return {
      ok: false,
      error: 'invalid_args',
      message: 'write_file requires a valid session bookId',
    };
  }
  if (ws === notesRoot) {
    return {
      ok: false,
      error: 'invalid_args',
      message: `path must be a file under ${notesRoot}/`,
      path: ws,
    };
  }
  if (!ws.startsWith(`${notesRoot}/`)) {
    return {
      ok: false,
      error: 'denied',
      message: `writes only under ${notesRoot}/ (OKF notes package for the current book)`,
      path: ws,
    };
  }

  const rel = ws.slice(notesRoot.length + 1);
  const parts = rel.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    return {
      ok: false,
      error: 'invalid_args',
      message: `invalid relative path under notes package: ${rel}`,
      path: ws,
    };
  }

  if (parts.length === 1) {
    const name = parts[0];
    if (name === 'AGENTS.md') {
      return {
        ok: false,
        error: 'denied',
        message:
          'AGENTS.md is skill-bundled (read /workspace/skills/note/AGENTS.md); not writable in the notes package',
        path: ws,
      };
    }
    if (!OKF_NOTES_ROOT_FILES.includes(name)) {
      return {
        ok: false,
        error: 'denied',
        message: `root notes file must be one of ${OKF_NOTES_ROOT_FILES.join(', ')}`,
        path: ws,
      };
    }
    return { ok: true, path: ws };
  }

  const top = parts[0];
  if (top === 'tools') {
    return {
      ok: false,
      error: 'denied',
      message:
        'tools/ is skill-bundled only (read /workspace/skills/note/tools/…); never write_file scripts into notes',
      path: ws,
    };
  }
  if (!OKF_NOTES_DIRS.includes(top)) {
    return {
      ok: false,
      error: 'denied',
      message: `unknown OKF directory "${top}"; allowed: ${OKF_NOTES_DIRS.join(', ')}`,
      path: ws,
    };
  }
  return { ok: true, path: ws };
}

/**
 * @param {{ getBooksRoot: () => string, bookId: string }} options
 */
export function createReadingTools(options) {
  const session = createBooksFsSession({ getBooksRoot: options.getBooksRoot });
  const bookId = options.bookId;

  return {
    read_file: tool({
      description:
        'Read UTF-8 text at an absolute /workspace path (extract chunks, or /workspace/skills/<id>/… package files).',
      inputSchema: z.object({
        path: z.string().describe('Absolute workspace path starting with /workspace'),
      }),
      execute: async ({ path }) => {
        try {
          const bytes = await session.readFile({ path });
          if (bytes === null) {
            return {
              ok: false,
              path,
              error: 'not_found',
              message: `file not found: ${path}`,
            };
          }
          const raw = new TextDecoder('utf-8').decode(bytes);
          return { ok: true, path, content: projectExtractContentForModel(raw) };
        } catch (err) {
          return {
            ok: false,
            path,
            error: 'denied',
            message: errorMessage(err),
          };
        }
      },
    }),

    write_file: tool({
      description:
        "Write UTF-8 into this book's OKF notes package under /workspace/.wellread/notes/<bookId>/ (overwrite). Only on explicit user save/ingest. Not for AGENTS.md or tools/ (skill-bundled).",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            'Absolute path under /workspace/.wellread/notes/<bookId>/ (OKF tree: index.md, log.md, or sources|chapters|concepts|frameworks|claims|glossary|questions/…)',
          ),
        content: z.string().describe('Full UTF-8 file contents to write (overwrite in place)'),
      }),
      execute: async ({ path, content }) => {
        const gate = authorizeOkfNotesWrite(path, bookId);
        if (!gate.ok) {
          return {
            ok: false,
            path: gate.path ?? path,
            error: gate.error,
            message: gate.message,
          };
        }
        try {
          await session.writeFile({
            path: gate.path,
            content: new TextEncoder().encode(content),
            confineNotesBookId: bookId,
          });
          return { ok: true, path: gate.path };
        } catch (err) {
          return {
            ok: false,
            path: gate.path,
            error: 'denied',
            message: errorMessage(err),
          };
        }
      },
    }),

    glob: tool({
      description: 'List file paths under /workspace/.wellread/ that match a glob pattern.',
      inputSchema: z.object({
        pattern: z.string().describe('Glob path pattern under /workspace/.wellread/'),
      }),
      execute: async ({ pattern }) => {
        try {
          const hits = globWellread(options.getBooksRoot(), pattern);
          return { ok: true, hits };
        } catch (err) {
          return {
            ok: false,
            error: 'denied',
            message: errorMessage(err),
            hits: [],
          };
        }
      },
    }),

    grep: tool({
      description:
        'Search file contents under /workspace/.wellread/ (returns path, line, matching text).',
      inputSchema: z.object({
        pattern: z.string().describe('Substring or regex to match against file lines'),
        path: z
          .string()
          .optional()
          .describe('Optional directory or file prefix under /workspace/.wellread/ to scope the search'),
        regex: z
          .boolean()
          .optional()
          .describe('Treat pattern as regex (default true); set false for literal match'),
      }),
      execute: async ({ pattern, path, regex }) => {
        try {
          const hits = grepWellread(options.getBooksRoot(), pattern, {
            path,
            regex: regex !== false,
            maxHits: GREP_MODEL_HIT_MAX,
          });
          return { ok: true, hits: hits.map(projectGrepHitForModel) };
        } catch (err) {
          return {
            ok: false,
            error: 'denied',
            message: errorMessage(err),
            hits: [],
          };
        }
      },
    }),
  };
}
