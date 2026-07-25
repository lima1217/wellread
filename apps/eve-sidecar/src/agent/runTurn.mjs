/**
 * Run one chat turn with AI SDK streamText + Books tools.
 */

import { streamText, stepCountIs } from 'ai';
import { randomBytes } from 'node:crypto';
import { normalizeThinkingMode, turnFetchContext } from '../createModel.mjs';
import {
  createAnswerContentGate,
  pickAnswerFromSteps,
} from './answerContent.mjs';
import { maybeCompressSession } from './contextCompress.mjs';
import { isAbortError } from './httpAbort.mjs';
import {
  appendReadingContext,
  buildReadingContextEnvelope,
  buildSystemPrompt,
  collectPriorSources,
  collectSourcesFromTools,
  listNotesIndex,
  parsePendingQuotesFromWire,
  stripLeadingQuoteBlocks,
} from './prompt.mjs';
import { maybeApplyFirstTurnTitle } from './sessionStore.mjs';
import { discoverSkills } from './skills/discover.mjs';
import { expandSkillCommand } from './skills/invoke.mjs';
import { createReadingTools } from './tools.mjs';
import { prepareToolExhaustionStep, resolveMaxToolRounds } from './toolRounds.mjs';

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
 *   readerState?: { chapter?: string | null, cfi?: string | null } | null,
 *   generateTextFn?: import('ai').generateText,
 *   persistSession?: (session: import('./sessionStore.mjs').Session) => void,
 *   tools?: import('ai').ToolSet,
 * }} input
 */
export async function runTurn(input) {
  const { model, session, userMessage, getBooksRoot, onEvent, abortSignal } = input;
  const persistSession = input.persistSession;
  const thinkingMode = normalizeThinkingMode(input.thinkingMode);
  const { quotes: turnQuotes } = parsePendingQuotesFromWire(userMessage);
  // Session / UI keep the slash form; only the model turn is expanded (Pi-style).
  // Quotes move into <reading_context>; model user text is quote-free.
  let modelUserMessage = userMessage;
  try {
    modelUserMessage = expandSkillCommand(userMessage, getBooksRoot()).modelMessage;
  } catch {
    // Missing books root or FS errors: send the original slash text.
  }
  // Empty is intentional when the turn is quote-only — quotes live in the envelope.
  modelUserMessage = stripLeadingQuoteBlocks(modelUserMessage);
  const userId = `msg_${randomBytes(6).toString('hex')}`;
  const userMsg = {
    id: userId,
    role: /** @type {const} */ ('user'),
    content: userMessage,
    createdAt: Date.now(),
  };
  session.messages.push(userMsg);
  onEvent({ type: 'message.user', id: userId, content: userMessage });

  if (abortSignal?.aborted) {
    return finishAborted(session, userId, onEvent, persistSession);
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
  const system = appendReadingContext(
    buildSystemPrompt({
      bookId: session.bookId,
      bookTitle: session.bookTitle,
      skills,
    }),
    envelope,
  );

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
      return finishAborted(session, userId, onEvent, persistSession);
    }
    dropInFlightUser(session, userId, persistSession);
    throw error;
  }

  if (abortSignal?.aborted) {
    return finishAborted(session, userId, onEvent, persistSession);
  }

  const tools =
    input.tools ?? createReadingTools({ getBooksRoot, bookId: session.bookId });
  /** @type {Array<{ id: string, name: string, args?: unknown, result?: unknown }>} */
  const toolTrace = [];

  const history = session.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(0, -1)
    .map((m) => ({
      role: /** @type {'user' | 'assistant'} */ (m.role),
      content: m.content,
    }));

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
        const result = streamText({
          model,
          system,
          messages: [...history, { role: 'user', content: modelUserMessage }],
          tools,
          abortSignal,
          // N tool-capable steps + 1 soft-landing answer (tools disabled).
          stopWhen: stepCountIs(maxToolRounds + 1),
          prepareStep: ({ stepNumber }) =>
            prepareToolExhaustionStep({ stepNumber, maxToolRounds, system }),
        });

        // Visible answer = tool-free steps only. Narration that shares a step
        // with tool calls stays out of content (and thus out of history).
        const answerGate = createAnswerContentGate((delta) => {
          onEvent({ type: 'message.assistant.delta', id: assistantId, delta });
        });
        /** Captured from fullStream `error` parts — AI SDK yields these instead of throwing. */
        let streamError = /** @type {unknown} */ (null);
        for await (const part of result.fullStream) {
          if (abortSignal?.aborted || part.type === 'abort') {
            return finishAborted(session, userId, onEvent, persistSession);
          }
          if (part.type === 'error') {
            streamError = part.error;
            continue;
          }
          if (part.type === 'start-step') {
            answerGate.startStep();
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
            answerGate.finishStep();
          }
        }

        if (abortSignal?.aborted) {
          return finishAborted(session, userId, onEvent, persistSession);
        }

        if (streamError != null) {
          if (isAbortError(streamError)) {
            return finishAborted(session, userId, onEvent, persistSession);
          }
          dropInFlightUser(session, userId, persistSession);
          onEvent({
            type: 'error',
            message:
              streamError instanceof Error ? streamError.message : String(streamError),
          });
          onEvent({ type: 'done' });
          return null;
        }

        let content = answerGate.getContent();
        // Never use result.text here — it concatenates every step, including
        // research-tool narration. Recover only write_file-mixed answer text
        // (gate first, then steps) so save confirmations are not blanked.
        if (!content.trim()) {
          try {
            const fromGate = answerGate.fallbackText();
            const fromSteps = fromGate
              ? ''
              : pickAnswerFromSteps(await result.steps);
            const fallback = fromGate || fromSteps;
            if (fallback.trim()) {
              answerGate.adoptFallback(fallback);
              content = answerGate.getContent();
            }
          } catch (error) {
            if (isAbortError(error) || abortSignal?.aborted) {
              return finishAborted(session, userId, onEvent, persistSession);
            }
            // AI SDK rejects with NoOutputGeneratedError when the stream ended
            // on an error/abort before any step finished — surface that, don't
            // pretend the model returned an empty successful reply.
            dropInFlightUser(session, userId, persistSession);
            onEvent({
              type: 'error',
              message: error instanceof Error ? error.message : String(error),
            });
            onEvent({ type: 'done' });
            return null;
          }
        }

        if (abortSignal?.aborted) {
          return finishAborted(session, userId, onEvent, persistSession);
        }

        if (!content.trim()) {
          dropInFlightUser(session, userId, persistSession);
          onEvent({
            type: 'error',
            message: 'Model returned an empty reply. Check API key/model.',
          });
          onEvent({ type: 'done' });
          return null;
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
      return finishAborted(session, userId, onEvent, persistSession);
    }
    dropInFlightUser(session, userId, persistSession);
    throw error;
  }
}

/**
 * Drop the in-flight user turn so failed/cancelled asks do not pollute history.
 * @param {import('./sessionStore.mjs').Session} session
 * @param {string} userId
 * @param {(session: import('./sessionStore.mjs').Session) => void} [persistSession]
 */
function dropInFlightUser(session, userId, persistSession) {
  const last = session.messages[session.messages.length - 1];
  if (last && last.id === userId && last.role === 'user') {
    session.messages.pop();
  }
  // Re-persist after rollback so clients reconciling mid-turn (e.g. after
  // compress-then-fail) never observe the unanswered user on disk.
  persistSession?.(session);
}

/**
 * Drop the in-flight user turn so cancelled asks do not pollute model history.
 * @param {import('./sessionStore.mjs').Session} session
 * @param {string} userId
 * @param {(event: Record<string, unknown>) => void} onEvent
 * @param {(session: import('./sessionStore.mjs').Session) => void} [persistSession]
 */
function finishAborted(session, userId, onEvent, persistSession) {
  dropInFlightUser(session, userId, persistSession);
  onEvent({ type: 'done', aborted: true });
  return null;
}
