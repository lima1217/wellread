/**
 * Run one chat turn with AI SDK streamText + Books tools.
 */

import { streamText, stepCountIs } from 'ai';
import { randomBytes } from 'node:crypto';
import { isAbortError } from './httpAbort.mjs';
import { buildSystemPrompt, collectSourcesFromTools } from './prompt.mjs';
import { createReadingTools } from './tools.mjs';
import { prepareToolExhaustionStep, resolveMaxToolRounds } from './toolRounds.mjs';

/**
 * @param {{
 *   model: import('ai').LanguageModel,
 *   session: import('./sessionStore.mjs').Session,
 *   userMessage: string,
 *   getBooksRoot: () => string,
 *   onEvent: (event: Record<string, unknown>) => void,
 *   maxToolRounds?: number,
 *   abortSignal?: AbortSignal,
 * }} input
 */
export async function runTurn(input) {
  const { model, session, userMessage, getBooksRoot, onEvent, abortSignal } = input;
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

  const system = buildSystemPrompt({
    bookId: session.bookId,
    bookTitle: session.bookTitle,
  });
  const maxToolRounds = resolveMaxToolRounds(
    input.maxToolRounds ?? process.env.EVE_MAX_TOOL_ROUNDS,
  );

  try {
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

    const assistantId = `msg_${randomBytes(6).toString('hex')}`;
    let content = '';
    for await (const delta of result.textStream) {
      if (abortSignal?.aborted) {
        return finishAborted(session, userId, onEvent);
      }
      content += delta;
      onEvent({ type: 'message.assistant.delta', id: assistantId, delta });
    }

    // DeepSeek / provider quirks can finish with empty textStream.
    // Prefer residual text (or reasoning text); keep provider error detail.
    /** @type {string} */
    let emptyDetail = '';
    if (!content.trim()) {
      try {
        const fallback = await result.text;
        if (typeof fallback === 'string' && fallback.trim()) {
          content = fallback;
          onEvent({ type: 'message.assistant.delta', id: assistantId, delta: fallback });
        } else {
          const reasoning = await result.reasoningText;
          if (typeof reasoning === 'string' && reasoning.trim()) {
            content = reasoning;
            onEvent({ type: 'message.assistant.delta', id: assistantId, delta: reasoning });
          }
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
    const assistantMsg = {
      id: assistantId,
      role: /** @type {const} */ ('assistant'),
      content,
      createdAt: Date.now(),
      ...(sources.length ? { sources } : {}),
      ...(toolTrace.length ? { tools: toolTrace } : {}),
    };
    session.messages.push(assistantMsg);
    onEvent({
      type: 'message.assistant',
      id: assistantId,
      content,
      sources: sources.length ? sources : undefined,
      tools: toolTrace.length ? toolTrace : undefined,
    });
    onEvent({ type: 'done' });
    return assistantMsg;
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
