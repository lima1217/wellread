/**
 * Run one chat turn with AI SDK streamText + Books tools.
 */

import { streamText, stepCountIs } from 'ai';
import { randomBytes } from 'node:crypto';
import { buildSystemPrompt, collectSourcesFromTools } from './prompt.mjs';
import { createReadingTools } from './tools.mjs';

/**
 * @param {{
 *   model: import('ai').LanguageModel,
 *   session: import('./sessionStore.mjs').Session,
 *   userMessage: string,
 *   getBooksRoot: () => string,
 *   onEvent: (event: Record<string, unknown>) => void,
 * }} input
 */
export async function runTurn(input) {
  const { model, session, userMessage, getBooksRoot, onEvent } = input;
  const userId = `msg_${randomBytes(6).toString('hex')}`;
  const userMsg = {
    id: userId,
    role: /** @type {const} */ ('user'),
    content: userMessage,
    createdAt: Date.now(),
  };
  session.messages.push(userMsg);
  onEvent({ type: 'message.user', id: userId, content: userMessage });

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

  const result = streamText({
    model,
    system: buildSystemPrompt({
      bookId: session.bookId,
      bookTitle: session.bookTitle,
    }),
    messages: [...history, { role: 'user', content: userMessage }],
    tools,
    stopWhen: stepCountIs(8),
    onStepFinish: async ({ toolCalls, toolResults }) => {
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
    content += delta;
    onEvent({ type: 'message.assistant.delta', id: assistantId, delta });
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
}
