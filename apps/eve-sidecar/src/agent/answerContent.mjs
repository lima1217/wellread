/**
 * Promote only tool-free step text into the visible assistant answer.
 * Narration that shares a step with research tools is dropped.
 * Mixed steps may recover only when every tool is a side-effect write
 * (answer + write_file), so save confirmations are not blanked.
 */

/** @type {ReadonlySet<string>} */
export const RECOVERABLE_MIXED_TOOLS = new Set(['write_file']);

/**
 * @param {unknown[]} toolCalls
 * @returns {string[]}
 */
export function toolNamesFromCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  /** @type {string[]} */
  const names = [];
  for (const call of toolCalls) {
    if (!call || typeof call !== 'object') continue;
    const rec = /** @type {{ toolName?: unknown, name?: unknown }} */ (call);
    const name =
      typeof rec.toolName === 'string'
        ? rec.toolName
        : typeof rec.name === 'string'
          ? rec.name
          : '';
    if (name) names.push(name);
  }
  return names;
}

/**
 * Mixed-step text is recoverable only when every tool is a known side-effect
 * write. Research tools (grep/read_file/glob/…) never recover — that text is
 * progress narration and must stay out of history.
 *
 * @param {string[]} toolNames
 * @returns {boolean}
 */
export function isRecoverableMixedTools(toolNames) {
  if (!Array.isArray(toolNames) || toolNames.length === 0) return false;
  return toolNames.every((name) => RECOVERABLE_MIXED_TOOLS.has(name));
}

/**
 * @param {(delta: string) => void} [onDelta]
 */
export function createAnswerContentGate(onDelta) {
  let content = '';
  let stepText = '';
  let stepHadTools = false;
  /** @type {string[]} */
  let stepToolNames = [];
  let lastStepText = '';
  /** @type {string[]} */
  let lastStepToolNames = [];

  return {
    startStep() {
      stepText = '';
      stepHadTools = false;
      stepToolNames = [];
    },

    /** @param {string} delta */
    onTextDelta(delta) {
      if (!delta) return;
      stepText += delta;
    },

    /** @param {string} [toolName] */
    onToolCall(toolName) {
      stepHadTools = true;
      if (typeof toolName === 'string' && toolName) {
        stepToolNames.push(toolName);
      }
    },

    finishStep() {
      lastStepText = stepText;
      lastStepToolNames = stepToolNames.slice();
      if (!stepHadTools && stepText) {
        content += stepText;
        onDelta?.(stepText);
      }
      stepText = '';
      stepHadTools = false;
      stepToolNames = [];
    },

    getContent() {
      return content;
    },

    /**
     * When the only text shared a recoverable write tool (answer + write_file),
     * recover that text so the turn is not empty. Research-tool narration never
     * recovers.
     * @returns {string}
     */
    fallbackText() {
      if (content.trim()) return '';
      if (!lastStepText.trim()) return '';
      if (!isRecoverableMixedTools(lastStepToolNames)) return '';
      return lastStepText;
    },

    /** @param {string} text */
    adoptFallback(text) {
      content = text;
      onDelta?.(text);
    },
  };
}

/**
 * Prefer the last tool-free step text; else the last mixed step whose tools are
 * all recoverable writes. Research-tool narration is never selected.
 *
 * @param {Array<{ text?: string, toolCalls?: unknown[] }>} steps
 * @returns {string}
 */
export function pickAnswerFromSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return '';
  let lastRecoverable = '';
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    const text = typeof step?.text === 'string' ? step.text : '';
    if (!text.trim()) continue;
    const toolCalls = step.toolCalls;
    const hasTools = Array.isArray(toolCalls) && toolCalls.length > 0;
    if (!hasTools) return text;
    const names = toolNamesFromCalls(toolCalls);
    if (!lastRecoverable && isRecoverableMixedTools(names)) {
      lastRecoverable = text;
    }
  }
  return lastRecoverable;
}
