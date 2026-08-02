/**
 * Run one chat turn with AI SDK streamText + Books tools.
 * Emits an AI SDK UIMessage chunk stream; text parts are sanitized for
 * leaked provider tool markup before reaching the client.
 */

import {
  createUIMessageStream,
  isStepCount,
  streamText,
  toUIMessageStream,
} from 'ai';
import { randomBytes } from 'node:crypto';
import {
  normalizeThinkingMode,
  resolveTurnModelPresentation,
  turnFetchContext,
} from '../createModel.mjs';
import { maybeCompressSession } from './contextCompress.mjs';
import { isAbortError } from './httpAbort.mjs';
import {
  buildModelMessages,
  serializeModelMessages,
} from './modelHistory.mjs';
import {
  appendReadingContext,
  buildReadingContextEnvelope,
  buildSystemPrompt,
  collectPriorSources,
  collectSourcesFromTools,
  listNotesIndex,
} from './prompt.mjs';
import { readExtractStatus } from './extractMeta.mjs';
import {
  resolveFocusChunks,
  resolveSectionChunksForReader,
} from './resolveSectionChunks.mjs';
import { maybeApplyFirstTurnTitle } from './sessionStore.mjs';
import { discoverSkills } from './skills/discover.mjs';
import { createReadingTools } from './tools.mjs';
import { createReasoningEmitter } from './reasoningEmitter.mjs';
import {
  ensureContinueHintOnMessage,
  sanitizeModelReplyText,
  sanitizeUIMessageTextParts,
  sanitizeUIMessageTextStream,
  TOOLS_READY_CONTINUE_HINT,
} from './sanitizeModelReply.mjs';
import {
  createToolParallelBudget,
  wrapToolsWithParallelBudget,
} from './toolParallelBudget.mjs';
import {
  prepareToolExhaustionStep,
  resolveFinalMaxOutputTokens,
  resolveMaxToolRounds,
} from './toolRounds.mjs';
import {
  encodeEveSideChunk,
  sessionToUIMessage,
  toolsFromUIMessage,
  uiMessageToSession,
} from '@wellread/eve-message';
import { parseSlashInvocation } from './skills/invoke.mjs';
import { logTurnContract } from './turnLog.mjs';
import { prepareUserTurn } from './userTurn.mjs';

/** Fallback when caller omits contextWindowTokens (matches createModel default). */
const DEFAULT_CONTEXT_WINDOW_TOKENS = 1_000_000;

/**
 * @param {{
 *   model: import('ai').LanguageModel,
 *   session: import('./sessionStore.mjs').Session,
 *   userMessage: string,
 *   getBooksRoot: () => string,
 *   maxToolRounds?: number,
 *   finalMaxOutputTokens?: number,
 *   abortSignal?: AbortSignal,
 *   contextWindowTokens?: number,
 *   thinkingMode?: 'think' | 'fast',
 *   apiMode?: 'chat' | 'responses',
 *   readerState?: { chapter?: string | null, cfi?: string | null, sectionIndex?: number | null } | null,
 *   generateTextFn?: import('ai').generateText,
 *   persistSession?: (session: import('./sessionStore.mjs').Session) => void,
 *   tools?: import('ai').ToolSet,
 * }} input
 * @returns {ReadableStream<import('ai').UIMessageChunk>}
 */
export function runTurn(input) {
  const { model, session, userMessage, getBooksRoot, abortSignal } = input;
  const persistSession = input.persistSession;
  const thinkingMode = normalizeThinkingMode(input.thinkingMode);
  const prepared = prepareUserTurn(userMessage, getBooksRoot);
  const modelUserMessage = prepared.modelContent;
  const turnQuotes = prepared.quotes;
  const userId = `msg_${randomBytes(6).toString('hex')}`;
  const userMsg = {
    id: userId,
    role: /** @type {const} */ ('user'),
    content: prepared.sessionContent,
    createdAt: Date.now(),
    ...(prepared.modelContent !== prepared.sessionContent
      ? { modelContent: prepared.modelContent }
      : {}),
  };
  session.messages.push(userMsg);

  const dropUser = () => {
    const last = session.messages[session.messages.length - 1];
    if (last && last.id === userId && last.role === 'user') {
      session.messages.pop();
    }
    persistSession?.(session);
  };

  let skills = [];
  let booksRoot = '';
  try {
    booksRoot = getBooksRoot();
    skills = discoverSkills({ booksRoot });
  } catch {
    // Missing books root or FS errors: omit catalog / notes index.
  }
  const priorSources = collectPriorSources(
    session.messages.filter((m) => m.id !== userId),
  );
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
    quotes: turnQuotes,
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
    quoteCount: Array.isArray(turnQuotes) ? turnQuotes.length : 0,
  });

  const contextWindowTokens =
    Number(input.contextWindowTokens) > 0
      ? Number(input.contextWindowTokens)
      : DEFAULT_CONTEXT_WINDOW_TOKENS;

  const parallelBudget = createToolParallelBudget();
  const tools = wrapToolsWithParallelBudget(
    input.tools ?? createReadingTools({ getBooksRoot, bookId: session.bookId }),
    parallelBudget,
  );

  const maxToolRounds = resolveMaxToolRounds(
    input.maxToolRounds ?? process.env.EVE_MAX_TOOL_ROUNDS,
  );
  const finalMaxOutputTokens = resolveFinalMaxOutputTokens(
    input.finalMaxOutputTokens ?? process.env.EVE_FINAL_MAX_OUTPUT_TOKENS,
  );

  const assistantId = `msg_${randomBytes(6).toString('hex')}`;
  /** @type {import('ai').StreamTextResult<any, any> | null} */
  let streamResult = null;
  let persisted = false;
  /** Set on abort/error/empty so onFinish never persists a partial orphan. */
  let skipPersist = false;

  const markFailed = () => {
    skipPersist = true;
    dropUser();
  };

  // Include the current user so the list does not end on a prior assistant.
  // AI SDK treats a trailing assistant in originalMessages as a continuation and
  // clones its parts into this turn's responseMessage (first reply + second).
  const originalMessages = session.messages.map(sessionToUIMessage);

  return createUIMessageStream({
    originalMessages,
    generateId: () => assistantId,
    onFinish: async ({ responseMessage, isAborted }) => {
      if (persisted) return;
      if (skipPersist || isAborted || abortSignal?.aborted) {
        if (!skipPersist) dropUser();
        return;
      }

      const toolTrace = toolsFromUIMessage(responseMessage);
      let text = sanitizeUIMessageTextParts(responseMessage);
      if (!text && toolTrace.length) {
        ensureContinueHintOnMessage(responseMessage, TOOLS_READY_CONTINUE_HINT);
        text = TOOLS_READY_CONTINUE_HINT;
      }
      // Tools-only turns still count: keep the ledger even without prose.
      if (!text && !toolTrace.length) {
        dropUser();
        return;
      }

      const sources = collectSourcesFromTools(toolTrace);

      /** @type {unknown[] | undefined} */
      let modelMessages;
      try {
        if (streamResult) {
          const response = await streamResult.response;
          modelMessages = serializeModelMessages(response?.messages);
        }
      } catch {
        modelMessages = undefined;
      }

      const assistantMsg = uiMessageToSession(responseMessage, {
        createdAt: Date.now(),
        sources: sources.length ? sources : undefined,
        modelMessages,
      });
      // Ensure denormalized tools/sources even if parts used tool-* types.
      if (toolTrace.length && !assistantMsg.tools?.length) {
        assistantMsg.tools = toolTrace;
      }
      if (sources.length) {
        assistantMsg.sources = sources;
      }
      if (text && !assistantMsg.content?.trim()) {
        assistantMsg.content = text;
      }

      session.messages.push(assistantMsg);
      maybeApplyFirstTurnTitle(session, userMessage);
      persistSession?.(session);
      persisted = true;
    },
    execute: async ({ writer }) => {
      if (abortSignal?.aborted) {
        markFailed();
        writer.write({ type: 'abort', reason: 'client aborted' });
        return;
      }

      try {
        const compressed = await maybeCompressSession({
          model,
          session,
          systemPrompt: system,
          contextWindowTokens,
          onEvent: (event) => {
            const chunk = encodeEveSideChunk(event);
            if (chunk) writer.write(chunk);
          },
          abortSignal,
          generateTextFn: input.generateTextFn,
        });
        if (compressed) {
          persistSession?.(session);
        }
      } catch (error) {
        if (isAbortError(error) || abortSignal?.aborted) {
          markFailed();
          writer.write({ type: 'abort', reason: 'client aborted' });
          return;
        }
        markFailed();
        writer.write({
          type: 'error',
          errorText: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      if (abortSignal?.aborted) {
        markFailed();
        writer.write({ type: 'abort', reason: 'client aborted' });
        return;
      }

      // Build after compress so this turn's model context matches disk/UI.
      const historyMessages = buildModelMessages({
        messages: session.messages,
        excludeMessageId: userId,
        currentUserModelContent: modelUserMessage,
      });

      // finish-step clears AI SDK activeReasoningParts — never reuse one id
      // across tool rounds or emit reasoning-end after that clear (kills Node).
      const reasoning = createReasoningEmitter(writer, {
        baseId: `reasoning_${assistantId}`,
      });

      try {
        await turnFetchContext.run(
          {
            thinkingMode,
            onReasoningDelta:
              thinkingMode === 'think'
                ? (delta) => {
                    if (abortSignal?.aborted) return;
                    reasoning.writeDelta(delta);
                  }
                : undefined,
          },
          async () => {
            const result = streamText(
              /** @type {Parameters<typeof streamText>[0]} */ ({
                model,
                messages: historyMessages,
                tools,
                abortSignal,
                stopWhen: isStepCount(maxToolRounds + 1),
                ...streamTextOptions,
                // After streamTextOptions so presentation cannot clobber loop control.
                prepareStep: ({ stepNumber }) => {
                  parallelBudget.beginStep();
                  return prepareToolExhaustionStep({
                    stepNumber,
                    maxToolRounds,
                    instructions: toolSystem,
                    maxOutputTokens: finalMaxOutputTokens,
                  });
                },
                onStepEnd: () => {
                  reasoning.beginNewSegment();
                },
              }),
            );
            streamResult = result;

            writer.merge(
              enrichUIMessageStreamWithSources(
                sanitizeUIMessageTextStream(
                  toUIMessageStream({
                    stream: result.stream,
                    generateMessageId: () => assistantId,
                    sendReasoning: false,
                    sendStart: true,
                    sendFinish: true,
                    onError: (error) =>
                      error instanceof Error ? error.message : String(error),
                  }),
                ),
              ),
            );

            try {
              // Prefer joining every step — result.text can be only the last step.
              const steps = await result.steps;
              const rawText = steps
                .map((step) => (typeof step.text === 'string' ? step.text : ''))
                .join('')
                .trim();
              const text = sanitizeModelReplyText(rawText);
              reasoning.stop();
              if (!text) {
                const hasTools = steps.some(
                  (step) => (step.toolCalls?.length ?? 0) > 0,
                );
                if (!hasTools) {
                  markFailed();
                  writer.write({
                    type: 'error',
                    errorText:
                      'Model returned an empty reply. Check API key/model.',
                  });
                } else {
                  // Keep tool ledger; surface a recoverable hint for the next poke.
                  const hintId = `text_continue_${assistantId}`;
                  writer.write({ type: 'text-start', id: hintId });
                  writer.write({
                    type: 'text-delta',
                    id: hintId,
                    delta: TOOLS_READY_CONTINUE_HINT,
                  });
                  writer.write({ type: 'text-end', id: hintId });
                }
              }
            } catch (error) {
              reasoning.stop();
              if (isAbortError(error) || abortSignal?.aborted) {
                markFailed();
                writer.write({ type: 'abort', reason: 'client aborted' });
                return;
              }
              markFailed();
              writer.write({
                type: 'error',
                errorText: error instanceof Error ? error.message : String(error),
              });
            }
          },
        );
      } catch (error) {
        reasoning.stop();
        if (isAbortError(error) || abortSignal?.aborted) {
          markFailed();
          writer.write({ type: 'abort', reason: 'client aborted' });
          return;
        }
        markFailed();
        writer.write({
          type: 'error',
          errorText: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

/**
 * After each tool output, push message-metadata.sources so the client can
 * resolve CFI citations during the live stream (not only after reconcile).
 *
 * @param {ReadableStream<import('ai').UIMessageChunk>} stream
 * @returns {ReadableStream<import('ai').UIMessageChunk>}
 */
export function enrichUIMessageStreamWithSources(stream) {
  /** @type {Map<string, { id: string, name: string, args?: unknown, result?: unknown }>} */
  const toolsById = new Map();
  let lastSourcesJson = '';
  return stream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        if (chunk.type === 'tool-input-available') {
          toolsById.set(chunk.toolCallId, {
            id: chunk.toolCallId,
            name: chunk.toolName,
            args: chunk.input,
          });
          return;
        }
        if (chunk.type !== 'tool-output-available') return;
        const prev = toolsById.get(chunk.toolCallId) ?? {
          id: chunk.toolCallId,
          name: 'tool',
        };
        toolsById.set(chunk.toolCallId, { ...prev, result: chunk.output });
        const sources = collectSourcesFromTools([...toolsById.values()]);
        const serialized = JSON.stringify(sources);
        if (!sources.length || serialized === lastSourcesJson) return;
        lastSourcesJson = serialized;
        controller.enqueue({
          type: 'message-metadata',
          messageMetadata: { sources },
        });
      },
    }),
  );
}

/**
 * Drain a UIMessage chunk stream (for tests). Persists via runTurn onFinish.
 * @param {ReadableStream<import('ai').UIMessageChunk>} stream
 * @returns {Promise<import('ai').UIMessageChunk[]>}
 */
export async function consumeUIMessageStream(stream) {
  const chunks = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}
