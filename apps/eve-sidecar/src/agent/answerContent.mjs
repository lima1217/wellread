/**
 * Promote only tool-free step text into the visible assistant answer.
 * Narration that shares a step with research tools is dropped.
 * write_file confirmations are synthesized from toolTrace paths (see
 * toolLedger.mjs), not from mixed-step narration.
 */

/**
 * @param {(delta: string) => void} [onDelta]
 */
export function createAnswerContentGate(onDelta) {
  let content = '';
  let stepText = '';
  let stepHadTools = false;

  return {
    startStep() {
      stepText = '';
      stepHadTools = false;
    },

    /** @param {string} delta */
    onTextDelta(delta) {
      if (!delta) return;
      stepText += delta;
    },

    onToolCall() {
      stepHadTools = true;
    },

    /**
     * @param {{ promote?: boolean }} [opts]
     * Soft-landing steps pass promote:false so exhaustion prose never streams.
     */
    finishStep(opts) {
      const promote = opts?.promote !== false;
      if (promote && !stepHadTools && stepText) {
        content += stepText;
        onDelta?.(stepText);
      }
      stepText = '';
      stepHadTools = false;
    },

    getContent() {
      return content;
    },

    /** @param {string} text */
    adoptFallback(text) {
      content = text;
      onDelta?.(text);
    },
  };
}

/**
 * Prefer the last tool-free step text. Mixed write_file narration is never
 * selected — confirmations come from formatWriteConfirmation(toolTrace).
 *
 * @param {Array<{ text?: string, toolCalls?: unknown[] }>} steps
 * @returns {string}
 */
export function pickAnswerFromSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return '';
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    const text = typeof step?.text === 'string' ? step.text : '';
    if (!text.trim()) continue;
    const toolCalls = step.toolCalls;
    const hasTools = Array.isArray(toolCalls) && toolCalls.length > 0;
    if (!hasTools) return text;
  }
  return '';
}
