/**
 * Structured OKF note-page compose for the note skill critical path.
 * Chat streamText stays on write_file(content=…); ingest content pages may
 * pass write_file(draft=…) so the sidecar expands via generateText + Output.object
 * (AI SDK v7 successor to generateObject) with one retry on failure.
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { isAbortError } from './httpAbort.mjs';
import { OKF_COMPOSE_PAGE_TYPES } from './notesOkf.mjs';

/** @typedef {import('ai').LanguageModel} LanguageModel */

export { OKF_COMPOSE_PAGE_TYPES } from './notesOkf.mjs';

export const OKF_COMPOSE_ORIGINS = Object.freeze([
  'chapter',
  'quote',
  'chat',
  'mixed',
]);

/** @type {[string, ...string[]]} */
const COMPOSE_TYPE_ENUM = /** @type {[string, ...string[]]} */ ([
  ...OKF_COMPOSE_PAGE_TYPES,
]);

/** Zod schema for one composable OKF content page (frontmatter + body). */
export const okfComposedPageSchema = z.object({
  type: z.enum(COMPOSE_TYPE_ENUM),
  title: z.string().min(1),
  description: z.string().default(''),
  origin: z.enum(OKF_COMPOSE_ORIGINS).optional(),
  source_refs: z.array(z.string()).optional(),
  chapter_refs: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['active', 'draft', 'deprecated']).optional(),
  body: z.string().min(1),
});

/** Tool-facing draft input (material expanded into a full page). */
export const okfNoteDraftSchema = z.object({
  type: z.enum(COMPOSE_TYPE_ENUM),
  title: z.string().min(1),
  description: z.string().optional(),
  origin: z.enum(OKF_COMPOSE_ORIGINS).optional(),
  source_refs: z.array(z.string()).optional(),
  chapter_refs: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['active', 'draft', 'deprecated']).optional(),
  material: z
    .string()
    .min(1)
    .describe('Source material / outline to expand into the markdown body'),
});

export const NOTE_COMPOSE_MAX_ATTEMPTS = 2;

/**
 * @param {z.infer<typeof okfComposedPageSchema>} page
 * @param {{ timestamp?: string }} [opts]
 * @returns {string}
 */
export function renderOkfNoteMarkdown(page, opts = {}) {
  const timestamp =
    typeof opts.timestamp === 'string' && opts.timestamp
      ? opts.timestamp
      : new Date().toISOString();
  /** @type {string[]} */
  const lines = ['---', `type: ${page.type}`, `title: ${yamlScalar(page.title)}`];
  if (page.description) {
    lines.push(`description: ${yamlScalar(page.description)}`);
  }
  if (page.origin) lines.push(`origin: ${page.origin}`);
  if (page.source_refs?.length) {
    lines.push(`source_refs: [${page.source_refs.map(yamlScalar).join(', ')}]`);
  }
  if (page.chapter_refs?.length) {
    lines.push(`chapter_refs: [${page.chapter_refs.map(yamlScalar).join(', ')}]`);
  }
  if (page.tags?.length) {
    lines.push(`tags: [${page.tags.map(yamlScalar).join(', ')}]`);
  }
  if (page.status) lines.push(`status: ${page.status}`);
  lines.push(`timestamp: ${timestamp}`);
  lines.push('---', '', page.body.trim(), '');
  return lines.join('\n');
}

/**
 * @param {string} value
 * @returns {string}
 */
function yamlScalar(value) {
  // Prefer JSON string so quotes/newlines stay valid YAML.
  return JSON.stringify(value);
}

/**
 * @param {{
 *   model: LanguageModel,
 *   path: string,
 *   draft: z.infer<typeof okfNoteDraftSchema>,
 *   generateTextFn?: typeof generateText,
 *   maxAttempts?: number,
 *   abortSignal?: AbortSignal,
 *   now?: () => Date,
 * }} input
 * @returns {Promise<
 *   | { ok: true, page: z.infer<typeof okfComposedPageSchema>, markdown: string, attempts: number }
 *   | { ok: false, error: string, message: string, attempts: number }
 * >}
 */
export async function composeOkfNotePage(input) {
  const maxAttempts = Math.max(
    1,
    Math.min(
      4,
      Number.isFinite(input.maxAttempts)
        ? Number(input.maxAttempts)
        : NOTE_COMPOSE_MAX_ATTEMPTS,
    ),
  );
  const generate = input.generateTextFn ?? generateText;
  const draft = okfNoteDraftSchema.parse(input.draft);
  let lastMessage = 'compose failed';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (input.abortSignal?.aborted) {
      return {
        ok: false,
        error: 'aborted',
        message: 'note compose aborted',
        attempts: attempt,
      };
    }
    try {
      const prompt = buildComposePrompt({
        path: input.path,
        draft,
        priorError: attempt > 1 ? lastMessage : null,
      });
      const result = await generate({
        model: input.model,
        output: Output.object({
          schema: okfComposedPageSchema,
          name: 'okf_note_page',
          description: 'One OKF notes package content page with YAML frontmatter fields and body',
        }),
        prompt,
        abortSignal: input.abortSignal,
      });
      const page = okfComposedPageSchema.parse(result.output);
      // Lock identity fields from the draft so the model cannot rename the target.
      const locked = {
        ...page,
        type: draft.type,
        title: draft.title,
        ...(draft.description != null ? { description: draft.description } : {}),
        ...(draft.origin != null ? { origin: draft.origin } : {}),
        ...(draft.source_refs != null ? { source_refs: draft.source_refs } : {}),
        ...(draft.chapter_refs != null ? { chapter_refs: draft.chapter_refs } : {}),
        ...(draft.tags != null ? { tags: draft.tags } : {}),
        ...(draft.status != null ? { status: draft.status } : {}),
      };
      const markdown = renderOkfNoteMarkdown(locked, {
        timestamp: (input.now?.() ?? new Date()).toISOString(),
      });
      return { ok: true, page: locked, markdown, attempts: attempt };
    } catch (err) {
      if (isAbortError(err) || input.abortSignal?.aborted) {
        return {
          ok: false,
          error: 'aborted',
          message: 'note compose aborted',
          attempts: attempt,
        };
      }
      lastMessage = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    ok: false,
    error: 'compose_failed',
    message: `note page compose failed after ${maxAttempts} attempt(s): ${lastMessage}`,
    attempts: maxAttempts,
  };
}

/**
 * @param {{
 *   path: string,
 *   draft: z.infer<typeof okfNoteDraftSchema>,
 *   priorError?: string | null,
 * }} input
 */
function buildComposePrompt(input) {
  const { path, draft, priorError } = input;
  const lines = [
    'Compose one OKF notes package markdown content page for Wellread.',
    'Return a single structured object matching the schema (not raw markdown).',
    'Rules:',
    '- concept-first; durable claims need cfi links in the body or belong in questions',
    '- body is markdown without YAML frontmatter (frontmatter fields are separate)',
    '- keep the page self-contained and readable without the chat transcript',
    `- target path: ${path}`,
    `- type: ${draft.type}`,
    `- title: ${draft.title}`,
  ];
  if (draft.description) lines.push(`- description hint: ${draft.description}`);
  if (draft.origin) lines.push(`- origin: ${draft.origin}`);
  if (draft.tags?.length) lines.push(`- tags: ${draft.tags.join(', ')}`);
  if (draft.source_refs?.length) {
    lines.push(`- source_refs: ${draft.source_refs.join(', ')}`);
  }
  if (draft.chapter_refs?.length) {
    lines.push(`- chapter_refs: ${draft.chapter_refs.join(', ')}`);
  }
  lines.push('', 'Source material / outline:', draft.material);
  if (priorError) {
    lines.push(
      '',
      'Previous attempt failed schema/parse validation. Fix the issues and try again.',
      `Error: ${priorError}`,
    );
  }
  return lines.join('\n');
}
