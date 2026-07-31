/**
 * Context-window compression for long reading-assistant sessions.
 * Trigger at 68% of the configured window; compress conversation to ~20%.
 */

import { generateText } from 'ai';
import { randomBytes } from 'node:crypto';
import { isAbortError } from './httpAbort.mjs';

export const COMPRESS_TRIGGER_RATIO = 0.68;
export const COMPRESS_TARGET_RATIO = 0.2;

/** Per-message role/framing overhead in the rough token estimate. */
const MSG_OVERHEAD_TOKENS = 4;

/**
 * @param {string | undefined | null} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

/**
 * @param {Array<{
 *   content?: string,
 *   reasoning?: string,
 *   tools?: unknown,
 *   modelMessages?: unknown,
 * }>} messages
 * @returns {number}
 */
export function estimateMessagesTokens(messages) {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content) + MSG_OVERHEAD_TOKENS;
    total += estimateTokens(m.reasoning);
    if (m.tools != null) {
      try {
        total += estimateTokens(JSON.stringify(m.tools));
      } catch {
        // ignore non-serializable tool traces
      }
    }
    if (m.modelMessages != null) {
      try {
        total += estimateTokens(JSON.stringify(m.modelMessages));
      } catch {
        // ignore non-serializable transcripts
      }
    }
  }
  return total;
}

/**
 * @param {{
 *   messages: Array<{ id: string, role: string, content: string }>,
 *   systemPrompt: string,
 *   contextWindowTokens: number,
 * }} input
 * @returns {{
 *   beforeTokens: number,
 *   targetTokens: number,
 *   dropIds: string[],
 *   keepIds: string[],
 *   summaryBudgetTokens: number,
 * } | null}
 */
export function planCompression(input) {
  const window = Number(input.contextWindowTokens);
  if (!Number.isFinite(window) || window <= 0) return null;

  const systemTokens = estimateTokens(input.systemPrompt);
  const beforeTokens = systemTokens + estimateMessagesTokens(input.messages);
  const trigger = Math.floor(window * COMPRESS_TRIGGER_RATIO);
  if (beforeTokens < trigger) return null;

  const targetTokens = Math.floor(window * COMPRESS_TARGET_RATIO);
  const messages = input.messages;
  if (messages.length === 0) return null;

  // Always keep the newest message (usually the in-flight user turn).
  const keep = [messages[messages.length - 1]];
  let keepTokens = estimateMessagesTokens(keep);

  // Leave room under the 20% target for system + a summary of the dropped prefix.
  const roomForKeepAndSummary = Math.max(0, targetTokens - systemTokens);
  const summaryBudgetTokens = Math.max(
    64,
    Math.min(Math.floor(roomForKeepAndSummary * 0.45), 512),
  );
  let keepBudget = Math.max(0, roomForKeepAndSummary - summaryBudgetTokens);

  // If the newest message alone exceeds the keep budget, still keep it alone.
  if (keepTokens > keepBudget) {
    keepBudget = keepTokens;
  }

  for (let i = messages.length - 2; i >= 0; i--) {
    const candidate = messages[i];
    // Same estimator as beforeTokens / keepTokens — include reasoning/tools/modelMessages.
    const add = estimateMessagesTokens([candidate]);
    if (keepTokens + add > keepBudget) break;
    keep.unshift(candidate);
    keepTokens += add;
  }

  const keepIds = keep.map((m) => m.id);
  const keepSet = new Set(keepIds);
  const dropIds = messages.filter((m) => !keepSet.has(m.id)).map((m) => m.id);

  // Nothing older to fold into a summary (e.g. a single oversized turn).
  if (dropIds.length === 0) return null;

  return {
    beforeTokens,
    targetTokens,
    dropIds,
    keepIds,
    summaryBudgetTokens,
  };
}

/**
 * @param {{
 *   messages: Array<Record<string, unknown> & { id: string }>,
 *   keepIds: string[],
 *   summary: string,
 *   summaryId: string,
 *   now?: number,
 * }} input
 */
export function applyCompressionPlan(input) {
  const keepSet = new Set(input.keepIds);
  const kept = input.messages.filter((m) => keepSet.has(m.id));
  const summaryText = String(input.summary || '').trim();
  const summaryMsg = {
    id: input.summaryId,
    role: /** @type {const} */ ('assistant'),
    content: summaryText
      ? `[Conversation summary]\n${summaryText}`
      : '[Conversation summary]\n(Earlier turns were compacted to fit the context window.)',
    createdAt: input.now ?? Date.now(),
    compacted: true,
  };
  return [summaryMsg, ...kept];
}

/**
 * Serialize dropped messages for the summarizer.
 * @param {Array<{ role: string, content: string }>} messages
 */
export function formatMessagesForSummary(messages) {
  return messages
    .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
    .join('\n\n');
}

/**
 * Build the summarizer instruction. `summaryBudgetTokens` guides length.
 * @param {{ bookTitle?: string, summaryBudgetTokens: number }} input
 */
export function buildCompressPrompt(input) {
  const title = (input.bookTitle || '').trim() || 'the current book';
  const maxChars = Math.max(200, input.summaryBudgetTokens * 4);
  return [
    `Compress the reading-assistant chat about "${title}" into a continuity summary for a future turn.`,
    'Output exactly these labeled lines (omit a line only if empty):',
    'goals: …',
    'conclusions: …',
    'open_questions: …',
    'cfi_refs: …',
    'Keep: user goals, key conclusions, named characters/plot points, CFIs or chapter refs, unresolved threads.',
    'Drop: chit-chat, repeated tool narration, and tool errors that were later resolved.',
    `At most ${maxChars} characters total. Plain labeled lines only — no markdown headings, no bullet lists.`,
  ].join(' ');
}

/**
 * Normalize summarizer output into the labeled continuity block stored on disk.
 * Accepts already-labeled text or free prose (falls back to conclusions:).
 * @param {string} raw
 * @returns {string}
 */
export function formatStructuredSummary(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return '';

  const fields = {
    goals: '',
    conclusions: '',
    open_questions: '',
    cfi_refs: '',
  };
  const labelRe =
    /^(goals|conclusions|open_questions|cfi_refs)\s*:\s*/i;
  /** @type {keyof typeof fields | null} */
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(labelRe);
    if (m) {
      current = /** @type {keyof typeof fields} */ (m[1].toLowerCase());
      fields[current] = line.slice(m[0].length).trim();
      continue;
    }
    if (current && line.trim()) {
      fields[current] = fields[current]
        ? `${fields[current]} ${line.trim()}`
        : line.trim();
    }
  }

  const hasLabeled = Object.values(fields).some(Boolean);
  if (!hasLabeled) {
    fields.conclusions = text.replace(/\s+/g, ' ').trim();
  }

  /** @type {string[]} */
  const lines = [];
  for (const key of /** @type {const} */ ([
    'goals',
    'conclusions',
    'open_questions',
    'cfi_refs',
  ])) {
    const v = fields[key].replace(/\s+/g, ' ').trim();
    if (v) lines.push(`${key}: ${v}`);
  }
  return lines.join('\n');
}

/**
 * If session history fills ≥68% of the window, LLM-summarize the dropped
 * prefix and rewrite `session.messages` so usage lands near 20%.
 *
 * On summarizer failure, leaves the session unchanged and returns false.
 *
 * @param {{
 *   model: import('ai').LanguageModel,
 *   session: import('./sessionStore.mjs').Session,
 *   systemPrompt: string,
 *   contextWindowTokens: number,
 *   onEvent: (event: Record<string, unknown>) => void,
 *   abortSignal?: AbortSignal,
 *   generateTextFn?: typeof generateText,
 * }} input
 * @returns {Promise<boolean>}
 */
export async function maybeCompressSession(input) {
  const generateTextFn = input.generateTextFn ?? generateText;
  const modelMessages = input.session.messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  );
  const plan = planCompression({
    messages: modelMessages,
    systemPrompt: input.systemPrompt,
    contextWindowTokens: input.contextWindowTokens,
  });
  if (!plan) return false;

  if (input.abortSignal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }

  const dropSet = new Set(plan.dropIds);
  const dropped = modelMessages.filter((m) => dropSet.has(m.id));

  /** @type {string} */
  let summaryText = '';
  try {
    const result = await generateTextFn({
      model: input.model,
      system: buildCompressPrompt({
        bookTitle: input.session.bookTitle,
        summaryBudgetTokens: plan.summaryBudgetTokens,
      }),
      prompt: formatMessagesForSummary(dropped),
      maxOutputTokens: plan.summaryBudgetTokens,
      abortSignal: input.abortSignal,
    });
    summaryText = typeof result.text === 'string' ? result.text : '';
  } catch (error) {
    if (isAbortError(error) || input.abortSignal?.aborted) {
      throw error;
    }
    input.onEvent({
      type: 'context.compress_failed',
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  summaryText = formatStructuredSummary(summaryText);

  const summaryId = `msg_${randomBytes(6).toString('hex')}`;
  input.session.messages = applyCompressionPlan({
    messages: input.session.messages,
    keepIds: plan.keepIds,
    summary: summaryText,
    summaryId,
  });

  const afterTokens =
    estimateTokens(input.systemPrompt) + estimateMessagesTokens(input.session.messages);
  const summaryMsg = input.session.messages[0];
  input.onEvent({
    type: 'context.compressed',
    beforeTokens: plan.beforeTokens,
    afterTokens,
    targetTokens: plan.targetTokens,
    removedIds: plan.dropIds,
    summary: {
      id: summaryMsg.id,
      role: summaryMsg.role,
      content: summaryMsg.content,
      createdAt: summaryMsg.createdAt,
      compacted: true,
    },
  });
  return true;
}
