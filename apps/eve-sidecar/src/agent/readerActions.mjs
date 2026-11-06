/**
 * Reader actions: tools that act in the open reader the way the reader does
 * (navigate, turn pages, highlight, annotate, bookmark, edit / delete
 * highlights and notes). Shared by the in-app Reading Assistant and external
 * MCP agents. The sidecar cannot touch the reader UI: execute hands each call
 * to `context.runReaderCommand`, which queues it for the reader window showing
 * the book (server/readerCommands.mjs); the window runs it through the same
 * code as the reader's own clicks and the result comes back as the tool
 * output.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { parallelGate } from './toolParallelBudget.mjs';

const HIGHLIGHT_COLORS = /** @type {const} */ (['yellow', 'red', 'green', 'blue', 'violet']);
const HIGHLIGHT_STYLES = /** @type {const} */ (['highlight', 'underline', 'squiggly']);
const passageText = z
  .string()
  .min(1)
  .max(2000)
  .describe('The passage exactly as printed in the book (copy it from extract text)');
const anchorCfi = z
  .string()
  .max(2000)
  .optional()
  .describe(
    'Any cfi in or near the passage (e.g. the extract chunk cfi it came from); narrows the search to that section',
  );

/** Specs: model-facing description, input schema, MCP behavior hints. */
export const READER_ACTIONS = {
  open_in_reader: {
    description:
      "Move the reader's view in Wellread to a passage: give text (exact quote; add cfi to narrow the section), a cfi (e.g. from search hits or annotations), or a sectionIndex. Returns the new position.",
    inputSchema: z
      .object({
        text: passageText.optional(),
        cfi: anchorCfi,
        sectionIndex: z.number().int().min(0).optional(),
      })
      .refine((a) => a.text || a.cfi || a.sectionIndex !== undefined, {
        message: 'give text, cfi or sectionIndex',
      }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  turn_page: {
    description: "Turn the reader's page forward (next) or back (prev), 1–20 pages. Returns the new position.",
    inputSchema: z.object({
      direction: z.enum(['next', 'prev']),
      pages: z.number().int().min(1).max(20).optional(),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  highlight: {
    description:
      "Highlight a passage in the book, optionally with a note (an annotation the reader sees on the page and in their notes list). Same record as the reader's own highlights. Returns the annotation id and cfi.",
    inputSchema: z.object({
      text: passageText,
      cfi: anchorCfi,
      sectionIndex: z.number().int().min(0).optional(),
      note: z.string().max(4000).optional().describe('Annotation text shown with the highlight'),
      color: z.enum(HIGHLIGHT_COLORS).optional().describe("Defaults to the reader's color"),
      style: z.enum(HIGHLIGHT_STYLES).optional().describe("Defaults to the reader's style"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  add_bookmark: {
    description:
      'Bookmark the page the reader is on, or the page holding a passage (text, optionally with cfi) or a cfi.',
    inputSchema: z.object({ text: passageText.optional(), cfi: anchorCfi }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  list_annotations: {
    description:
      "The reader's highlights, notes and bookmarks in this book with their ids (for update_annotation / delete_annotation), cfi, text, note, color, style and chapter, in book order.",
    inputSchema: z.object({
      type: z.enum(['annotation', 'bookmark', 'excerpt']).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    annotations: { readOnlyHint: true },
  },
  update_annotation: {
    description:
      'Change the note, color or style of a highlight / annotation (or the note of a bookmark) by id from list_annotations or highlight.',
    inputSchema: z
      .object({
        id: z.string().min(1),
        note: z.string().max(4000).optional(),
        color: z.enum(HIGHLIGHT_COLORS).optional(),
        style: z.enum(HIGHLIGHT_STYLES).optional(),
      })
      .refine((a) => a.note !== undefined || a.color || a.style, {
        message: 'give note, color or style',
      }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  delete_annotation: {
    description: 'Delete a highlight, annotation or bookmark by id (from list_annotations or highlight).',
    inputSchema: z.object({ id: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
};

/**
 * @param {import('zod').ZodTypeAny} contextSchema readingToolContextSchema
 *   (passed in to keep tools.mjs ↔ this module acyclic)
 * @returns {import('ai').ToolSet}
 */
export function createReaderActionTools(contextSchema) {
  /** @type {import('ai').ToolSet} */
  const tools = {};
  for (const [name, spec] of Object.entries(READER_ACTIONS)) {
    tools[name] = tool({
      description: spec.description,
      inputSchema: spec.inputSchema,
      contextSchema,
      execute: async (input, { context }) => {
        const blocked = parallelGate(context.parallelBudget, name);
        if (blocked) return blocked;
        if (typeof context.runReaderCommand !== 'function') {
          return {
            ok: false,
            error: 'reader_unavailable',
            message: 'Reader actions are unavailable here.',
          };
        }
        return context.runReaderCommand(context.bookId, name, input);
      },
    });
  }
  return tools;
}
