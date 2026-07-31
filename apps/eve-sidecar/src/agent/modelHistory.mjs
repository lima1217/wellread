/**
 * Build AI SDK ModelMessage history from session messages, including
 * reasoning + tool-call/tool-result parts when available.
 *
 * DeepSeek Responses is stateless — the client must resend structured items.
 */

/**
 * @typedef {{
 *   id: string,
 *   role: string,
 *   content: string,
 *   modelContent?: string,
 *   reasoning?: string,
 *   tools?: Array<{ id: string, name: string, args?: unknown, result?: unknown }>,
 *   modelMessages?: unknown[],
 * }} HistorySourceMessage
 */

/**
 * @param {{
 *   messages: HistorySourceMessage[],
 *   excludeMessageId?: string,
 *   currentUserModelContent: string,
 * }} input
 * @returns {import('ai').ModelMessage[]}
 */
export function buildModelMessages(input) {
  /** @type {import('ai').ModelMessage[]} */
  const out = [];
  for (const message of input.messages) {
    if (!message || message.id === input.excludeMessageId) continue;
    if (message.role === 'user') {
      const content =
        typeof message.modelContent === 'string' && message.modelContent.length > 0
          ? message.modelContent
          : message.content;
      out.push({ role: 'user', content: content ?? '' });
      continue;
    }
    if (message.role !== 'assistant') continue;
    out.push(...assistantToModelMessages(message));
  }
  out.push({ role: 'user', content: input.currentUserModelContent });
  return out;
}

/**
 * @param {HistorySourceMessage} message
 * @returns {import('ai').ModelMessage[]}
 */
export function assistantToModelMessages(message) {
  if (Array.isArray(message.modelMessages) && message.modelMessages.length > 0) {
    return /** @type {import('ai').ModelMessage[]} */ (
      message.modelMessages.filter((row) => row && typeof row === 'object')
    );
  }
  return legacyAssistantToModelMessages(message);
}

/**
 * Rebuild a minimal tool/reasoning transcript from display fields when
 * `modelMessages` was not persisted (older sessions).
 *
 * @param {HistorySourceMessage} message
 * @returns {import('ai').ModelMessage[]}
 */
export function legacyAssistantToModelMessages(message) {
  const tools = Array.isArray(message.tools) ? message.tools : [];
  const reasoning =
    typeof message.reasoning === 'string' ? message.reasoning.trim() : '';
  const text = typeof message.content === 'string' ? message.content : '';

  /** @type {Array<Record<string, unknown>>} */
  const assistantParts = [];
  if (reasoning) {
    assistantParts.push({
      type: 'reasoning',
      text: reasoning,
      providerOptions: {
        openai: { itemId: `rs_${message.id}` },
      },
    });
  }
  if (text) {
    assistantParts.push({ type: 'text', text });
  }
  for (const tool of tools) {
    if (!tool?.id || !tool?.name) continue;
    assistantParts.push({
      type: 'tool-call',
      toolCallId: tool.id,
      toolName: tool.name,
      input: tool.args ?? {},
    });
  }

  /** @type {import('ai').ModelMessage[]} */
  const out = [];
  if (assistantParts.length === 0) {
    out.push({ role: 'assistant', content: text });
    return out;
  }
  out.push({
    role: 'assistant',
    content: /** @type {import('ai').AssistantContent} */ (assistantParts),
  });

  if (tools.length > 0) {
    /** @type {Array<Record<string, unknown>>} */
    const toolParts = [];
    for (const tool of tools) {
      if (!tool?.id || !tool?.name) continue;
      toolParts.push({
        type: 'tool-result',
        toolCallId: tool.id,
        toolName: tool.name,
        output: { type: 'json', value: tool.result ?? null },
      });
    }
    if (toolParts.length > 0) {
      out.push({
        role: 'tool',
        content: /** @type {import('ai').ToolContent} */ (toolParts),
      });
    }
  }
  return out;
}

/**
 * Persist only JSON-safe model messages from an AI SDK turn response.
 * @param {unknown} messages
 * @returns {unknown[] | undefined}
 */
export function serializeModelMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  try {
    return JSON.parse(JSON.stringify(messages));
  } catch {
    return undefined;
  }
}
