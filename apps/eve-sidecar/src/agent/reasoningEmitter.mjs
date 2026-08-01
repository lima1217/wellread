/**
 * Safe reasoning UI-message chunks for createUIMessageStream.
 *
 * AI SDK clears `activeReasoningParts` on every `finish-step` (tool round).
 * Reusing one reasoning id across steps, or writing reasoning-end after that
 * clear, throws inside the stream transform and kills the Node sidecar.
 */

/**
 * @param {{ write: (chunk: Record<string, unknown>) => void }} writer
 * @param {{ baseId: string }} options
 */
export function createReasoningEmitter(writer, options) {
  const baseId = options.baseId;
  let segment = 0;
  /** @type {string | null} */
  let reasoningId = null;
  let stopped = false;

  return {
    /**
     * @param {string} delta
     */
    writeDelta(delta) {
      if (stopped || !delta) return;
      if (!reasoningId) {
        reasoningId = `${baseId}_${segment}`;
        segment += 1;
        writer.write({ type: 'reasoning-start', id: reasoningId });
      }
      writer.write({
        type: 'reasoning-delta',
        id: reasoningId,
        delta,
      });
    },

    /**
     * Call when the model finishes a step (tool round). Does not emit
     * reasoning-end — finish-step already dropped the active map entry.
     */
    beginNewSegment() {
      reasoningId = null;
    },

    /**
     * Stop accepting deltas. Avoids reasoning-end after finish-step races.
     */
    stop() {
      stopped = true;
      reasoningId = null;
    },
  };
}
