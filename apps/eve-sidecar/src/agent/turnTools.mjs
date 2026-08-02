/**
 * Bind reading tools + parallel budget for one turn.
 * One path: toolsContext always carries bookId/booksRoot/parallelBudget.
 */

import {
  createToolParallelBudget,
  wrapToolsWithParallelBudget,
} from './toolParallelBudget.mjs';
import { createReadingTools, readingToolsContext } from './tools.mjs';

/**
 * @param {unknown} def
 * @returns {boolean}
 */
function hasReadingContextSchema(def) {
  return Boolean(
    def &&
      typeof def === 'object' &&
      'contextSchema' in def &&
      /** @type {{ contextSchema?: unknown }} */ (def).contextSchema,
  );
}

/**
 * Always binds toolsContext. Injected tools with readingToolContextSchema
 * gate via parallelGate themselves (mockReadingTool / production tools).
 * Bare ToolSet entries (no contextSchema) are wrapped so parallel budget
 * cannot silently disappear.
 *
 * @param {{
 *   bookId: string,
 *   booksRoot: string,
 *   tools?: import('ai').ToolSet,
 *   model?: import('ai').LanguageModel,
 *   composeGenerateTextFn?: typeof import('ai').generateText,
 *   abortSignal?: AbortSignal,
 * }} input
 * @returns {{
 *   tools: import('ai').ToolSet,
 *   toolsContext: Record<string, import('./tools.mjs').ReadingToolContext>,
 *   runtimeContext: { parallelBudget: ReturnType<typeof createToolParallelBudget> },
 *   parallelBudget: ReturnType<typeof createToolParallelBudget>,
 * }}
 */
export function bindTurnTools(input) {
  const parallelBudget = createToolParallelBudget();
  const rawTools = input.tools ?? createReadingTools();
  /** @type {import('ai').ToolSet} */
  const tools = {};
  for (const [name, def] of Object.entries(rawTools)) {
    if (input.tools && !hasReadingContextSchema(def)) {
      const wrapped = wrapToolsWithParallelBudget(
        { [name]: def },
        parallelBudget,
      );
      tools[name] = wrapped[name];
      continue;
    }
    tools[name] = def;
  }
  const context = {
    bookId: input.bookId,
    booksRoot: input.booksRoot,
    parallelBudget,
    ...(input.model ? { model: input.model } : {}),
    ...(input.composeGenerateTextFn
      ? { composeGenerateTextFn: input.composeGenerateTextFn }
      : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  };
  return {
    tools,
    toolsContext: readingToolsContext(tools, context),
    runtimeContext: { parallelBudget },
    parallelBudget,
  };
}
