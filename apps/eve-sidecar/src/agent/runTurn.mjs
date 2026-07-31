/**
 * Run one chat turn with AI SDK streamText + Books tools.
 */

import { streamText, stepCountIs } from 'ai';
import { randomBytes } from 'node:crypto';
import {
  normalizeApiMode,
  normalizeThinkingMode,
  THINK_MODE_REASONING_EFFORT,
  turnFetchContext,
} from '../createModel.mjs';
import {
  createAnswerContentGate,
  pickAnswerFromSteps,
} from './answerContent.mjs';
import { isDegenerateAnswer } from './answerQuality.mjs';
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
import { maybeApplyFirstTurnTitle } from './sessionStore.mjs';
import { discoverSkills } from './skills/discover.mjs';
import { formatToolLedger, formatWriteConfirmation } from './toolLedger.mjs';
import { createReadingTools } from './tools.mjs';
import { prepareToolExhaustionStep, resolveMaxToolRounds } from './toolRounds.mjs';
import { prepareUserTurn } from './userTurn.mjs';

export const DEGENERATE_ANSWER_ERROR =
  'Model returned a degenerate reply after the tool budget was spent. Try a narrower question.';

/** Fallback when caller omits contextWindowTokens (matches createModel default). */
const DEFAULT_CONTEXT_WINDOW_TOKENS = 1_000_000;

/**
 * @param {{
 *   model: import('ai').LanguageModel,
 *   session: import('./sessionStore.mjs').Session,
 *   userMessage: string,
 *   getBooksRoot: () => string,
 *   onEvent: (event: Record<string, unknown>) => void,
 *   maxToolRounds?: number,
 *   abortSignal?: AbortSignal,
 *   contextWindowTokens?: number,
 *   thinkingMode?: 'think' | 'fast',
 *   apiMode?: 'chat' | 'responses',
 *   readerState?: { chapter?: string | null, cfi?: string | null, sectionIndex?: number | null } | null,
 *   generateTextFn?: import('ai').generateText,
 *   persistSession?: (session: import('./sessionStore.mjs').Session) => void,
 *   tools?: import('ai').ToolSet,
 * }} input
 */
export async function runTurn(input) {
  const { model, session, userMessage, getBooksRoot, onEvent, abortSignal } = input;
  const persistSession = input.persistSession;
  const thinkingMode = normalizeThinkingMode(input.thinkingMode);
  const apiMode = normalizeApiMode(input.apiMode);
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
  onEvent({ type: 'message.user', id: userId, content: prepared.sessionContent });

  const settle = createTurnSettler({
    session,
    userId,
    onEvent,
    persistSession,
  });

  if (abortSignal?.aborted) {
    return settle.aborted();
  }

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
  const envelope = buildReadingContextEnvelope({
    bookId: session.bookId,
    bookTitle: session.bookTitle,
    readerState: input.readerState,
    quotes: turnQuotes,
    priorSources,
    notesIndex,
  });
  const instructions = buildSystemPrompt({
    bookId: session.bookId,
    bookTitle: session.bookTitle,
    skills,
  });
  // Full system for compression + soft-landing; Responses puts stable
  // instructions in providerOptions and turn envelope in `system`.
  const system = appendReadingContext(instructions, envelope);

  const contextWindowTokens =
    Number(input.contextWindowTokens) > 0
      ? Number(input.contextWindowTokens)
      : DEFAULT_CONTEXT_WINDOW_TOKENS;

  try {
    const compressed = await maybeCompressSession({
      model,
      session,
      systemPrompt: system,
      contextWindowTokens,
      onEvent,
      abortSignal,
      generateTextFn: input.generateTextFn,
    });
    if (compressed) {
      persistSession?.(session);
    }
  } catch (error) {
    if (isAbortError(error) || abortSignal?.aborted) {
      return settle.aborted();
    }
    settle.drop();
    throw error;
  }

  if (abortSignal?.aborted) {
    return settle.aborted();
  }

  const tools =
    input.tools ?? createReadingTools({ getBooksRoot, bookId: session.bookId });
  /** @type {Array<{ id: string, name: string, args?: unknown, result?: unknown }>} */
  const toolTrace = [];

  const historyMessages = buildModelMessages({
    messages: session.messages,
    excludeMessageId: userId,
    currentUserModelContent: modelUserMessage,
  });

  const maxToolRounds = resolveMaxToolRounds(
    input.maxToolRounds ?? process.env.EVE_MAX_TOOL_ROUNDS,
  );

  const assistantId = `msg_${randomBytes(6).toString('hex')}`;
  let reasoning = '';

  try {
    return await turnFetchContext.run(
      {
        thinkingMode,
        onReasoningDelta:
          thinkingMode === 'think'
            ? (delta) => {
                if (abortSignal?.aborted) return;
                reasoning += delta;
                onEvent({
                  type: 'message.assistant.reasoning.delta',
                  id: assistantId,
                  delta,
                });
              }
            : undefined,
      },
      async () => {
        // Flags set from prepareStep (more reliable than fullStream start-step).
        let softLandingStep = false;
        let usedSoftLanding = false;
        const answerGate = createAnswerContentGate((delta) => {
          onEvent({ type: 'message.assistant.delta', id: assistantId, delta });
        });

        /** @type {Record<string, unknown>} */
        const streamOptions = {
          model,
          messages: historyMessages,
          tools,
          abortSignal,
          // N tool-capable steps + 1 soft-landing answer (tools disabled).
          stopWhen: stepCountIs(maxToolRounds + 1),
          prepareStep: ({ stepNumber }) => {
            // Responses keeps stable catalog in providerOptions.instructions —
            // soft-landing must not re-inject it via `system` (would duplicate).
            const prep = prepareToolExhaustionStep({
              stepNumber,
              maxToolRounds,
              system: apiMode === 'responses' ? envelope || '' : system,
            });
            softLandingStep = Boolean(prep);
            if (softLandingStep) usedSoftLanding = true;
            return prep;
          },
        };

        if (apiMode === 'responses') {
          // Stable catalog/skills → instructions; turn-varying envelope → system.
          streamOptions.system = envelope || undefined;
          streamOptions.providerOptions = {
            openai: {
              store: false,
              instructions,
              reasoningEffort:
                thinkingMode === 'think' ? THINK_MODE_REASONING_EFFORT : 'none',
            },
          };
        } else {
          streamOptions.system = system;
        }

        const result = streamText(
          /** @type {Parameters<typeof streamText>[0]} */ (streamOptions),
        );

        // Visible answer = tool-free steps only. Soft-landing (budget spent)
        // never promotes model prose — content becomes a toolTrace ledger.
        /** Captured from fullStream `error` parts — AI SDK yields these instead of throwing. */
        let streamError = /** @type {unknown} */ (null);
        for await (const part of result.fullStream) {
          if (abortSignal?.aborted || part.type === 'abort') {
            return settle.aborted();
          }
          if (part.type === 'error') {
            streamError = part.error;
            continue;
          }
          if (part.type === 'start-step') {
            answerGate.startStep();
            continue;
          }
          if (part.type === 'reasoning-delta') {
            // Reasoning UI is fed by fetch-layer onReasoningDelta (Chat
            // reasoning_content + DeepSeek Responses reasoning_text). Skip SDK
            // duplicates here.
            continue;
          }
          if (part.type === 'text-delta') {
            answerGate.onTextDelta(part.text);
            continue;
          }
          if (part.type === 'tool-call') {
            answerGate.onToolCall(part.toolName);
            const id = part.toolCallId || `tool_${randomBytes(4).toString('hex')}`;
            const entry = {
              id,
              name: part.toolName,
              args: part.input,
            };
            toolTrace.push(entry);
            onEvent({ type: 'tool.start', id, name: entry.name, args: entry.args });
            continue;
          }
          if (part.type === 'tool-result') {
            const id = part.toolCallId;
            const existing = toolTrace.find((t) => t.id === id);
            if (existing) {
              existing.result = part.output;
            }
            onEvent({
              type: 'tool.end',
              id,
              name: part.toolName,
              result: part.output,
            });
            continue;
          }
          if (part.type === 'tool-error') {
            const id = part.toolCallId;
            const existing = toolTrace.find((t) => t.id === id);
            const errResult = {
              error: part.error instanceof Error ? part.error.message : String(part.error),
            };
            if (existing) {
              existing.result = errResult;
            }
            onEvent({
              type: 'tool.end',
              id,
              name: part.toolName,
              result: errResult,
            });
            continue;
          }
          if (part.type === 'finish-step') {
            answerGate.finishStep({ promote: !softLandingStep });
          }
        }

        if (abortSignal?.aborted) {
          return settle.aborted();
        }

        if (streamError != null) {
          if (isAbortError(streamError)) {
            return settle.aborted();
          }
          return settle.error(
            streamError instanceof Error ? streamError.message : String(streamError),
          );
        }

        let content = '';
        if (usedSoftLanding) {
          content = formatToolLedger(toolTrace);
          answerGate.adoptFallback(content);
        } else {
          content = answerGate.getContent();
          // Never use result.text — it concatenates every step. Prefer tool-free
          // step text; else synthesize write confirmations from write_file paths.
          if (!content.trim()) {
            try {
              const fromSteps = pickAnswerFromSteps(await result.steps);
              const fromWrites = fromSteps.trim()
                ? ''
                : formatWriteConfirmation(toolTrace);
              const fallback = fromSteps.trim() ? fromSteps : fromWrites;
              if (fallback.trim()) {
                answerGate.adoptFallback(fallback);
                content = answerGate.getContent();
              }
            } catch (error) {
              if (isAbortError(error) || abortSignal?.aborted) {
                return settle.aborted();
              }
              return settle.error(
                error instanceof Error ? error.message : String(error),
              );
            }
          }
        }

        if (abortSignal?.aborted) {
          return settle.aborted();
        }

        if (!content.trim()) {
          return settle.error(
            'Model returned an empty reply. Check API key/model.',
          );
        }

        // Ledger content is ours; only screen natural (non-exhaustion) answers.
        if (!usedSoftLanding && isDegenerateAnswer(content)) {
          return settle.error(DEGENERATE_ANSWER_ERROR);
        }

        /** @type {unknown[] | undefined} */
        let modelMessages;
        try {
          const response = await result.response;
          modelMessages = serializeModelMessages(response?.messages);
        } catch {
          modelMessages = undefined;
        }

        const sources = collectSourcesFromTools(toolTrace);
        const reasoningText = reasoning.trim();
        const assistantMsg = {
          id: assistantId,
          role: /** @type {const} */ ('assistant'),
          content,
          createdAt: Date.now(),
          ...(reasoningText ? { reasoning: reasoningText } : {}),
          ...(sources.length ? { sources } : {}),
          ...(toolTrace.length ? { tools: toolTrace } : {}),
          ...(modelMessages ? { modelMessages } : {}),
        };
        session.messages.push(assistantMsg);
        maybeApplyFirstTurnTitle(session, userMessage);
        onEvent({
          type: 'message.assistant',
          id: assistantId,
          content,
          reasoning: reasoningText || undefined,
          sources: sources.length ? sources : undefined,
          tools: toolTrace.length ? toolTrace : undefined,
        });
        onEvent({ type: 'done' });
        return assistantMsg;
      },
    );
  } catch (error) {
    if (isAbortError(error) || abortSignal?.aborted) {
      return settle.aborted();
    }
    settle.drop();
    throw error;
  }
}

/**
 * One place owns in-flight user rollback + terminal events.
 * @param {{
 *   session: import('./sessionStore.mjs').Session,
 *   userId: string,
 *   onEvent: (event: Record<string, unknown>) => void,
 *   persistSession?: (session: import('./sessionStore.mjs').Session) => void,
 * }} ctx
 */
function createTurnSettler(ctx) {
  const drop = () => {
    const last = ctx.session.messages[ctx.session.messages.length - 1];
    if (last && last.id === ctx.userId && last.role === 'user') {
      ctx.session.messages.pop();
    }
    // Re-persist after rollback so clients reconciling mid-turn (e.g. after
    // compress-then-fail) never observe the unanswered user on disk.
    ctx.persistSession?.(ctx.session);
  };

  return {
    drop,
    aborted() {
      drop();
      ctx.onEvent({ type: 'done', aborted: true });
      return null;
    },
    /** @param {string} message */
    error(message) {
      drop();
      ctx.onEvent({ type: 'error', message });
      ctx.onEvent({ type: 'done' });
      return null;
    },
  };
}
