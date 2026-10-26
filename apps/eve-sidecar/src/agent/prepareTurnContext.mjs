/**
 * Pre-stream turn context: envelope, tools, model presentation, budgets.
 * runTurn owns stream lifecycle; this module owns prep knowledge.
 */

import {
  normalizeThinkingMode,
  resolveTurnModelPresentation,
} from '../createModel.mjs';
import { shouldAttachNativeWebSearch } from '../createModel.adapters.mjs';
import { readExtractStatus } from './extractMeta.mjs';
import { listNotesIndex } from './notesIndex.mjs';
import {
  buildReadingContextEnvelope,
  buildSystemPrompt,
  collectPriorSources,
  prependReadingContext,
} from './prompt.mjs';
import {
  resolveChunksForCfi,
  resolveFocusChunks,
  resolveSectionChunksForReader,
} from './resolveSectionChunks.mjs';
import { discoverSkills } from './skills/discover.mjs';
import { readAnnotationsStatus } from './annotations.mjs';
import { createSpoilerGuard } from './spoilerGuard.mjs';
import { parseSlashInvocation } from './skills/invoke.mjs';
import {
  resolveFinalMaxOutputTokens,
  resolveMaxToolRounds,
} from './toolRounds.mjs';
import { logTurnContract } from './turnLog.mjs';
import { bindTurnTools, maybeAttachNativeWebSearch } from './turnTools.mjs';
import { prepareUserTurn } from './userTurn.mjs';

/**
 * Drop envelope chunk paths the spoiler guard hides (count follows).
 * @template {{ paths: string[], count: number } | null} T
 * @param {T} resolved
 * @param {import('./spoilerGuard.mjs').SpoilerGuard | null} guard
 * @returns {T}
 */
function withVisiblePaths(resolved, guard) {
  if (!resolved || !guard) return resolved;
  const { paths, hidden } = guard.filterPaths(resolved.paths);
  if (!hidden) return resolved;
  return { ...resolved, paths, count: Math.max(0, resolved.count - hidden) };
}

/**
 * @param {{
 *   session: import('./sessionStore.mjs').Session,
 *   userMessage: string,
 *   getBooksRoot: () => string,
 *   thinkingMode?: 'think' | 'fast',
 *   apiMode?: 'chat' | 'responses',
 *   baseURL?: string | null,
 *   readerState?: { chapter?: string | null, cfi?: string | null, sectionIndex?: number | null } | null,
 *   spoilerGuard?: boolean,
 *   maxToolRounds?: number,
 *   finalMaxOutputTokens?: number,
 *   tools?: import('ai').ToolSet, // schema tools self-gate; bare tools wrapped in bindTurnTools
 *   model?: import('ai').LanguageModel,
 *   composeGenerateTextFn?: typeof import('ai').generateText,
 *   abortSignal?: AbortSignal,
 *   contextWindowTokens?: number,
 * }} input
 */
export function prepareTurnContext(input) {
  const thinkingMode = normalizeThinkingMode(input.thinkingMode);
  const prepared = prepareUserTurn(input.userMessage, input.getBooksRoot);
  const { session } = input;
  const webSearchEnabled = shouldAttachNativeWebSearch({
    baseURL: input.baseURL,
    apiMode: input.apiMode,
  });

  let skills = [];
  let booksRoot = '';
  try {
    booksRoot = input.getBooksRoot();
    skills = discoverSkills({ booksRoot });
  } catch {
    // Missing books root or FS errors: omit catalog / notes index.
  }

  // Caller has not pushed this turn's user message yet.
  const priorSources = collectPriorSources(session.messages);
  const notesIndex = booksRoot
    ? listNotesIndex(booksRoot, session.bookId)
    : [];
  const spoilerGuard = createSpoilerGuard({
    enabled: input.spoilerGuard,
    booksRoot,
    bookId: session.bookId,
    readerState: input.readerState,
  });
  const sectionChunks = withVisiblePaths(
    booksRoot
      ? resolveSectionChunksForReader({
          booksRoot,
          bookId: session.bookId,
          readerState: input.readerState,
        })
      : null,
    spoilerGuard,
  );
  const focusChunks = withVisiblePaths(
    booksRoot
      ? resolveFocusChunks({
          booksRoot,
          bookId: session.bookId,
          readerState: input.readerState,
        })
      : null,
    spoilerGuard,
  );
  const annotations = booksRoot ? readAnnotationsStatus(booksRoot, session.bookId) : null;
  const extractStatus = booksRoot
    ? readExtractStatus(booksRoot, session.bookId)
    : { status: 'missing', chunkCount: 0, schemaVersion: null };
  // Selection anchors → the extract chunk(s) that hold each quote.
  const quotes = prepared.quotes.map((q) =>
    q.cfi && booksRoot
      ? {
          ...q,
          chunks: resolveChunksForCfi({ booksRoot, bookId: session.bookId, cfi: q.cfi }),
        }
      : q,
  );
  const envelope = buildReadingContextEnvelope({
    bookId: session.bookId,
    bookTitle: session.bookTitle,
    readerState: input.readerState,
    quotes,
    priorSources,
    notesIndex,
    extractStatus,
    focusChunks,
    sectionChunks,
    annotations,
    spoilerGuard: spoilerGuard ? { limitCfi: spoilerGuard.limitCfi } : null,
  });
  const instructions = buildSystemPrompt({
    bookId: session.bookId,
    bookTitle: session.bookTitle,
    skills,
    webSearchEnabled,
  });
  // System stays stable across turns (provider prompt caching); the per-turn
  // envelope is prepended to this turn's user message and persisted with it,
  // so earlier turns keep their own quotes/position byte-for-byte.
  const system = instructions;
  const modelContent = prependReadingContext(prepared.modelContent, envelope);
  const { toolSystem, streamTextOptions } = resolveTurnModelPresentation({
    apiMode: input.apiMode,
    thinkingMode,
    instructions,
  });

  logTurnContract({
    sessionId: session.id,
    bookId: session.bookId,
    extractStatus: extractStatus.status,
    focusVia: focusChunks?.via ?? null,
    focusCount: focusChunks?.count ?? 0,
    sectionVia: sectionChunks?.via ?? null,
    sectionCount: sectionChunks?.count ?? 0,
    skillId: parseSlashInvocation(input.userMessage)?.skillId ?? null,
    quoteCount: Array.isArray(prepared.quotes) ? prepared.quotes.length : 0,
  });

  const bound = bindTurnTools({
    bookId: session.bookId,
    booksRoot,
    tools: input.tools,
    model: input.model,
    composeGenerateTextFn: input.composeGenerateTextFn,
    abortSignal: input.abortSignal,
    contextWindowTokens: input.contextWindowTokens,
    spoilerGuard,
  });
  const tools = maybeAttachNativeWebSearch(bound.tools, {
    baseURL: input.baseURL,
    apiMode: input.apiMode,
  });
  const { toolsContext, runtimeContext, parallelBudget } = bound;

  const maxToolRounds = resolveMaxToolRounds(
    input.maxToolRounds ?? process.env.EVE_MAX_TOOL_ROUNDS,
  );
  const finalMaxOutputTokens = resolveFinalMaxOutputTokens(
    input.finalMaxOutputTokens ?? process.env.EVE_FINAL_MAX_OUTPUT_TOKENS,
  );

  return {
    prepared: { ...prepared, modelContent },
    envelope,
    thinkingMode,
    system,
    toolSystem,
    streamTextOptions,
    tools,
    toolsContext,
    runtimeContext,
    parallelBudget,
    maxToolRounds,
    finalMaxOutputTokens,
  };
}
