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
import { projectExtractContentForModel } from './extractChunk.mjs';
import {
  extractUnavailableEnvelope,
  readExtractStatus,
} from './extractMeta.mjs';
import {
  OKF_NOTES_DIRS,
  OKF_NOTES_ROOT_FILES,
  isSafeBookIdSegment,
  notesPackageWorkspaceRoot,
} from './notesOkf.mjs';
import { resolveSectionQuery } from './resolveSectionChunks.mjs';
import { parallelGate } from './toolParallelBudget.mjs';

export { OKF_NOTES_DIRS, OKF_NOTES_ROOT_FILES } from './notesOkf.mjs';

function isExtractWorkspacePath(path) {
  return (
    typeof path === 'string' &&
    path.startsWith('/workspace/.wellread/extract/')
  );
}

/**
 * @param {() => string} getBooksRoot
 * @param {string} bookId
 */
function booksExtractGate(getBooksRoot, bookId) {
  try {
    const booksRoot = getBooksRoot();
    const status = readExtractStatus(booksRoot, bookId);
    return extractUnavailableEnvelope(status.status);
  } catch (err) {
    return {
      ok: false,
      error: 'unavailable',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Cap model-facing grep hits (search may return more internally). */
export const GREP_MODEL_HIT_MAX = 40;

/** Truncate each grep line text for token density. */
export const GREP_LINE_TEXT_MAX = 160;

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
 * Per-tool context passed via streamText `toolsContext` (not closures).
 *
 * `parallelBudget` is the same mutable object also placed on streamText
 * `runtimeContext`: prepareStep resets counters via beginStep(); each
 * execute gates via parallelGate(tryConsume). Not two budgets — one ref,
 * two SDK injection points.
 */
export const readingToolContextSchema = z.object({
  bookId: z.string(),
  booksRoot: z.string(),
  parallelBudget: z.custom(
    (v) =>
      Boolean(v) &&
      typeof v === 'object' &&
      typeof /** @type {{ tryConsume?: unknown }} */ (v).tryConsume === 'function',
  ),
});

/**
 * @typedef {{
 *   bookId: string,
 *   booksRoot: string,
 *   parallelBudget: import('./toolParallelBudget.mjs').ToolParallelBudget,
 * }} ReadingToolContext
 */

/**
 * Reading-assistant tools. Inject turn state via streamText `toolsContext`
 * (same object for every tool name), not factory closures.
 */
export function createReadingTools() {
  return {
    read_file: tool({
      description:
        'Read UTF-8 text at an absolute /workspace path (extract chunks, or /workspace/skills/<id>/… package files). At most 8 read/search tools (read_file/grep/glob/resolve_section) may run in parallel per step.',
      inputSchema: z.object({
        path: z.string().describe('Absolute workspace path starting with /workspace'),
      }),
      contextSchema: readingToolContextSchema,
      execute: async ({ path }, { context }) => {
        const blocked = parallelGate(context.parallelBudget, 'read_file');
        if (blocked) return blocked;
        const { bookId, booksRoot } = context;
        if (isExtractWorkspacePath(path)) {
          const gate = booksExtractGate(() => booksRoot, bookId);
          if (gate) return { ...gate, path };
        }
        const session = createBooksFsSession({ getBooksRoot: () => booksRoot });
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
        "Write UTF-8 into this book's OKF notes package under /workspace/.wellread/notes/<bookId>/ (overwrite). Only on explicit user save/ingest. Not for AGENTS.md or tools/ (skill-bundled). At most 16 write_file calls may run in parallel per step.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            'Absolute path under /workspace/.wellread/notes/<bookId>/ (OKF tree: index.md, log.md, or sources|chapters|concepts|frameworks|claims|glossary|questions/…)',
          ),
        content: z.string().describe('Full UTF-8 file contents to write (overwrite in place)'),
      }),
      contextSchema: readingToolContextSchema,
      execute: async ({ path, content }, { context }) => {
        const blocked = parallelGate(context.parallelBudget, 'write_file');
        if (blocked) return blocked;
        const { bookId, booksRoot } = context;
        const gate = authorizeOkfNotesWrite(path, bookId);
        if (!gate.ok) {
          return {
            ok: false,
            path: gate.path ?? path,
            error: gate.error,
            message: gate.message,
          };
        }
        const session = createBooksFsSession({ getBooksRoot: () => booksRoot });
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

    resolve_section: tool({
      description:
        "List this book's extract chunk paths for one spine section (by sectionIndex and/or chapter title). Prefer this over globbing extract chunks/*.md. When both are set, sectionIndex wins. Then read_file the returned paths in order (≤8 read/search tools per step).",
      inputSchema: z.object({
        sectionIndex: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('0-based spine sectionIndex from reading_context or toc/chunk frontmatter'),
        title: z
          .string()
          .optional()
          .describe('Chapter/section title to match against chunk frontmatter title'),
      }),
      contextSchema: readingToolContextSchema,
      execute: async ({ sectionIndex, title }, { context }) => {
        const blocked = parallelGate(context.parallelBudget, 'resolve_section', {
          count: 0,
          paths: [],
        });
        if (blocked) return blocked;
        const { bookId, booksRoot } = context;
        try {
          const gate = extractUnavailableEnvelope(
            readExtractStatus(booksRoot, bookId).status,
          );
          if (gate) return { ...gate, count: 0, paths: [] };
          return resolveSectionQuery({
            booksRoot,
            bookId,
            sectionIndex,
            title,
          });
        } catch (err) {
          return {
            ok: false,
            error: 'unavailable',
            message: errorMessage(err),
            count: 0,
            paths: [],
          };
        }
      },
    }),

    glob: tool({
      description:
        'List file paths under /workspace/.wellread/ that match a glob pattern. For a book section/chapter, use resolve_section instead of globbing extract chunks/*. Counts toward the ≤8 parallel read/search tools per step.',
      inputSchema: z.object({
        pattern: z.string().describe('Glob path pattern under /workspace/.wellread/'),
      }),
      contextSchema: readingToolContextSchema,
      execute: async ({ pattern }, { context }) => {
        const blocked = parallelGate(context.parallelBudget, 'glob', { hits: [] });
        if (blocked) return blocked;
        try {
          const hits = globWellread(context.booksRoot, pattern);
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
        'Search file contents under /workspace/.wellread/ (returns path, line, matching text). Counts toward the ≤8 parallel read/search tools per step.',
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
      contextSchema: readingToolContextSchema,
      execute: async ({ pattern, path, regex }, { context }) => {
        const blocked = parallelGate(context.parallelBudget, 'grep', { hits: [] });
        if (blocked) return blocked;
        const { bookId, booksRoot } = context;
        if (typeof path === 'string' && isExtractWorkspacePath(path.trim())) {
          const gate = booksExtractGate(() => booksRoot, bookId);
          if (gate) return { ...gate, hits: [] };
        }
        try {
          const hits = grepWellread(booksRoot, pattern, {
            path,
            regex: regex !== false,
            maxHits: GREP_MODEL_HIT_MAX,
          });
          return { ok: true, hits: hits.map(projectGrepHitForModel) };
        } catch (err) {
          const msg = errorMessage(err);
          if (msg.startsWith('invalid_grep_pattern:')) {
            return {
              ok: false,
              error: 'invalid_grep_pattern',
              message: msg,
              hits: [],
            };
          }
          return {
            ok: false,
            error: 'denied',
            message: msg,
            hits: [],
          };
        }
      },
    }),
  };
}

/**
 * Build the per-tool toolsContext map (shared context object for every tool).
 *
 * @param {import('ai').ToolSet} tools
 * @param {ReadingToolContext} context
 * @returns {Record<string, ReadingToolContext>}
 */
export function readingToolsContext(tools, context) {
  /** @type {Record<string, ReadingToolContext>} */
  const out = {};
  for (const name of Object.keys(tools)) {
    out[name] = context;
  }
  return out;
}
