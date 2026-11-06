/**
 * Pre-stream turn context: envelope, tools, model presentation, budgets.
 * runTurn owns stream lifecycle; this module owns prep knowledge.
 */

import {
  normalizeThinkingMode,
  resolveTurnModelPresentation,
} from '../createModel.mjs';
import { shouldAttachNativeWebSearch } from '../createModel.adapters.mjs';
import { createCitationVerifier } from './citationGuard.mjs';
import {
  buildSystemPrompt,
  collectPriorSources,
  prependReadingContext,
} from './prompt.mjs';
import { buildReadingSnapshot } from './readingSnapshot.mjs';
import { discoverSkills } from './skills/discover.mjs';
import { parseSlashInvocation } from './skills/invoke.mjs';
import {
  resolveFinalMaxOutputTokens,
  resolveMaxToolRounds,
} from './toolRounds.mjs';
import { logTurnContract } from './turnLog.mjs';
import { bindTurnTools, maybeAttachNativeWebSearch } from './turnTools.mjs';
import { prepareUserTurn } from './userTurn.mjs';

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
 *   shareAnnotations?: boolean, // false: other books' annotation exports stay private
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
  const {
    envelope,
    spoilerGuard,
    extractStatus,
    focusChunks,
    focusTexts,
    sectionChunks,
    memory,
  } = buildReadingSnapshot({
    booksRoot,
    bookId: session.bookId,
    bookTitle: session.bookTitle,
    readerState: input.readerState,
    spoilerGuard: input.spoilerGuard,
    quotes: prepared.quotes,
    priorSources: collectPriorSources(session.messages),
  });
  const instructions = buildSystemPrompt({
    bookId: session.bookId,
    bookTitle: session.bookTitle,
    skills,
    webSearchEnabled,
    memory,
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
    focusInlined: focusTexts.length,
    memoryEntries: memory ? memory.reader.length + memory.book.length : 0,
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
    bookTitle: session.bookTitle,
    shareAnnotations: input.shareAnnotations,
    spoilerGuard,
  });
  const tools = maybeAttachNativeWebSearch(bound.tools, {
    baseURL: input.baseURL,
    apiMode: input.apiMode,
  });
  const { toolsContext, runtimeContext, parallelBudget } = bound;
  // Seeded before this turn's user message is pushed; tool outputs stream in.
  const citationVerifier = createCitationVerifier({
    booksRoot,
    bookId: session.bookId,
    spoilerGuard,
    messages: session.messages,
    currentUserModelContent: modelContent,
  });

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
    citationVerifier,
    maxToolRounds,
    finalMaxOutputTokens,
  };
}
