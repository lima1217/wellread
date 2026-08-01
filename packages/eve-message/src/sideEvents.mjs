/**
 * Reading Assistant UIMessage side-channel events (context compress, etc.).
 * Sidecar encodes; host decodes — one schema for both ends.
 */

export const EVE_CONTEXT_COMPRESSED_CHUNK = 'data-eve-context-compressed';
export const EVE_CONTEXT_COMPRESS_FAILED_CHUNK = 'data-eve-context-compress-failed';

/**
 * @typedef {{
 *   type: 'context.compressed',
 *   beforeTokens: number,
 *   afterTokens: number,
 *   targetTokens: number,
 *   removedIds: string[],
 *   summary: {
 *     id: string,
 *     role: 'assistant' | 'user' | 'system',
 *     content: string,
 *     createdAt: number,
 *     compacted?: boolean,
 *   },
 * }} EveContextCompressedEvent
 *
 * @typedef {{
 *   type: 'context.compress_failed',
 *   message: string,
 * }} EveContextCompressFailedEvent
 *
 * @typedef {EveContextCompressedEvent | EveContextCompressFailedEvent} EveContextSideEvent
 *
 * @typedef {{
 *   type: 'error',
 *   message: string,
 * } | {
 *   type: 'abort',
 *   reason?: string,
 * } | EveContextSideEvent} EveSideEvent
 *
 * @typedef {{
 *   type: string,
 *   data?: unknown,
 *   errorText?: string,
 *   reason?: unknown,
 * }} EveSideChunk
 */

/**
 * Encode a logical context side event into a UIMessage data chunk for the stream writer.
 * @param {EveContextSideEvent} event
 * @returns {EveSideChunk | null}
 */
export function encodeEveSideChunk(event) {
  if (event?.type === 'context.compressed') {
    // Field allowlist — do not rest-spread the event onto the wire.
    return {
      type: EVE_CONTEXT_COMPRESSED_CHUNK,
      data: {
        beforeTokens: event.beforeTokens,
        afterTokens: event.afterTokens,
        targetTokens: event.targetTokens,
        removedIds: event.removedIds,
        summary: event.summary,
      },
    };
  }
  if (event?.type === 'context.compress_failed') {
    return {
      type: EVE_CONTEXT_COMPRESS_FAILED_CHUNK,
      data: { message: event.message },
    };
  }
  return null;
}

/**
 * Decode a UIMessage chunk into a host-facing side event (or null if not a side channel).
 * @param {EveSideChunk | null | undefined} chunk
 * @returns {EveSideEvent | null}
 */
export function decodeEveSideChunk(chunk) {
  if (!chunk || typeof chunk.type !== 'string') return null;
  if (chunk.type === 'error') {
    return { type: 'error', message: String(chunk.errorText ?? '') };
  }
  if (chunk.type === 'abort') {
    return {
      type: 'abort',
      reason: 'reason' in chunk ? String(chunk.reason ?? '') : undefined,
    };
  }
  if (chunk.type === EVE_CONTEXT_COMPRESSED_CHUNK) {
    const data = chunk.data && typeof chunk.data === 'object' ? chunk.data : null;
    if (!data) return null;
    return { type: 'context.compressed', ...data };
  }
  if (chunk.type === EVE_CONTEXT_COMPRESS_FAILED_CHUNK) {
    const data = chunk.data && typeof chunk.data === 'object' ? chunk.data : {};
    return {
      type: 'context.compress_failed',
      message: String(/** @type {{ message?: unknown }} */ (data).message ?? ''),
    };
  }
  return null;
}
