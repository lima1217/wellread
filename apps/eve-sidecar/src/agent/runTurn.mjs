/**
 * Run one chat turn with AI SDK streamText + Books tools.
 */

import { streamText, stepCountIs } from 'ai';
import { randomBytes } from 'node:crypto';
import { normalizeThinkingMode, turnFetchContext } from '../createModel.mjs';
import { maybeCompressSession } from './contextCompress.mjs';
import { isAbortError } from './httpAbort.mjs';
import { buildSystemPrompt, collectSourcesFromTools } from './prompt.mjs';
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
 *   generateTextFn?: import('ai').generateText,
 * }} input
 */
export async function runTurn(input) {
  const { model, session, userMessage, getBooksRoot, onEvent, abortSignal } = input;
  const thinkingMode = normalizeThinkingMode(input.thinkingMode);
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
    return finishAborted(session, userId, onEvent);
  }

  const system = buildSystemPrompt({
    bookId: session.bookId,
    bookTitle: session.bookTitle,
  });

  const contextWindowTokens =
    Number(input.contextWindowTokens) > 0
      ? Number(input.contextWindowTokens)
      : DEFAULT_CONTEXT_WINDOW_TOKENS;

  try {
    await maybeCompressSession({
      model,
      session,
      systemPrompt: system,
      contextWindowTokens,
      onEvent,
      abortSignal,
      generateTextFn: input.generateTextFn,
    });
  } catch (error) {
    if (isAbortError(error) || abortSignal?.aborted) {
      return finishAborted(session, userId, onEvent);
    }
    throw error;
  }

  if (abortSignal?.aborted) {
    return finishAborted(session, userId, onEvent);
  }

  const tools = createReadingTools({ getBooksRoot });
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
          messages: [...history, { role: 'user', content: userMessage }],
          tools,
          abortSignal,
          // N tool-capable steps + 1 soft-landing answer (tools disabled).
          stopWhen: stepCountIs(maxToolRounds + 1),
          prepareStep: ({ stepNumber }) =>
            prepareToolExhaustionStep({ stepNumber, maxToolRounds, system }),
          onStepFinish: async ({ toolCalls, toolResults }) => {
            if (abortSignal?.aborted) return;
            if (!toolCalls) return;
            for (let i = 0; i < toolCalls.length; i++) {
              const call = toolCalls[i];
              const toolResult = toolResults?.[i];
              const id = call.toolCallId || `tool_${randomBytes(4).toString('hex')}`;
              const entry = {
                id,
                name: call.toolName,
                args: call.input,
                result: toolResult?.output,
              };
              toolTrace.push(entry);
              onEvent({ type: 'tool.start', id, name: entry.name, args: entry.args });
              onEvent({ type: 'tool.end', id, name: entry.name, result: entry.result });
            }
          },
        });

        let content = '';
        for await (const delta of result.textStream) {
          if (abortSignal?.aborted) {
            return finishAborted(session, userId, onEvent);
          }
          content += delta;
          onEvent({ type: 'message.assistant.delta', id: assistantId, delta });
        }

        // Residual text only — never promote reasoning into the answer body.
        /** @type {string} */
        let emptyDetail = '';
        if (!content.trim()) {
          try {
            const fallback = await result.text;
            if (typeof fallback === 'string' && fallback.trim()) {
              content = fallback;
              onEvent({ type: 'message.assistant.delta', id: assistantId, delta: fallback });
            }
          } catch (error) {
            if (isAbortError(error) || abortSignal?.aborted) {
              return finishAborted(session, userId, onEvent);
            }
            if (error instanceof Error && error.message) {
              emptyDetail = ` (${error.message})`;
            }
          }
        }

        if (abortSignal?.aborted) {
          return finishAborted(session, userId, onEvent);
        }

        if (!content.trim()) {
          onEvent({
            type: 'error',
            message: `Model returned an empty reply. Check API key/model.${emptyDetail}`,
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
      return finishAborted(session, userId, onEvent);
    }
    throw error;
  }
}

/**
 * Drop the in-flight user turn so cancelled asks do not pollute model history.
 * @param {import('./sessionStore.mjs').Session} session
 * @param {string} userId
 * @param {(event: Record<string, unknown>) => void} onEvent
 */
function finishAborted(session, userId, onEvent) {
  const last = session.messages[session.messages.length - 1];
  if (last && last.id === userId && last.role === 'user') {
    session.messages.pop();
  }
  onEvent({ type: 'done', aborted: true });
  return null;
}
