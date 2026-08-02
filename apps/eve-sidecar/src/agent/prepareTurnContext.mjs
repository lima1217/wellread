/**
 * Pre-stream turn context: envelope, tools, model presentation, budgets.
 * runTurn owns stream lifecycle; this module owns prep knowledge.
 */

import {
  normalizeThinkingMode,
  resolveTurnModelPresentation,
} from '../createModel.mjs';
import { readExtractStatus } from './extractMeta.mjs';
import { listNotesIndex } from './notesIndex.mjs';
import {
  appendReadingContext,
  buildReadingContextEnvelope,
  buildSystemPrompt,
  collectPriorSources,
} from './prompt.mjs';
import {
  resolveFocusChunks,
  resolveSectionChunksForReader,
} from './resolveSectionChunks.mjs';
import { discoverSkills } from './skills/discover.mjs';
import { parseSlashInvocation } from './skills/invoke.mjs';
import {
  resolveFinalMaxOutputTokens,
  resolveMaxToolRounds,
} from './toolRounds.mjs';
import { logTurnContract } from './turnLog.mjs';
import { bindTurnTools } from './turnTools.mjs';
import { prepareUserTurn } from './userTurn.mjs';

/**
 * @param {{
 *   session: import('./sessionStore.mjs').Session,
 *   userMessage: string,
 *   getBooksRoot: () => string,
 *   thinkingMode?: 'think' | 'fast',
 *   apiMode?: 'chat' | 'responses',
 *   readerState?: { chapter?: string | null, cfi?: string | null, sectionIndex?: number | null } | null,
 *   maxToolRounds?: number,
 *   finalMaxOutputTokens?: number,
 *   tools?: import('ai').ToolSet, // schema tools self-gate; bare tools wrapped in bindTurnTools
 * }} input
 */
export function prepareTurnContext(input) {
  const thinkingMode = normalizeThinkingMode(input.thinkingMode);
  const prepared = prepareUserTurn(input.userMessage, input.getBooksRoot);
  const { session } = input;

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
  const sectionChunks = booksRoot
    ? resolveSectionChunksForReader({
        booksRoot,
        bookId: session.bookId,
        readerState: input.readerState,
      })
    : null;
  const focusChunks = booksRoot
    ? resolveFocusChunks({
        booksRoot,
        bookId: session.bookId,
        readerState: input.readerState,
      })
    : null;
  const extractStatus = booksRoot
    ? readExtractStatus(booksRoot, session.bookId)
    : { status: 'missing', chunkCount: 0, schemaVersion: null };
  const envelope = buildReadingContextEnvelope({
    bookId: session.bookId,
    bookTitle: session.bookTitle,
    readerState: input.readerState,
    quotes: prepared.quotes,
    priorSources,
    notesIndex,
    extractStatus,
    focusChunks,
    sectionChunks,
  });
  const instructions = buildSystemPrompt({
    bookId: session.bookId,
    bookTitle: session.bookTitle,
    skills,
  });
  const system = appendReadingContext(instructions, envelope);
  const { toolSystem, streamTextOptions } = resolveTurnModelPresentation({
    apiMode: input.apiMode,
    thinkingMode,
    system,
    envelope,
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

  const { tools, toolsContext, runtimeContext, parallelBudget } = bindTurnTools({
    bookId: session.bookId,
    booksRoot,
    tools: input.tools,
  });

  const maxToolRounds = resolveMaxToolRounds(
    input.maxToolRounds ?? process.env.EVE_MAX_TOOL_ROUNDS,
  );
  const finalMaxOutputTokens = resolveFinalMaxOutputTokens(
    input.finalMaxOutputTokens ?? process.env.EVE_FINAL_MAX_OUTPUT_TOKENS,
  );

  return {
    prepared,
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
