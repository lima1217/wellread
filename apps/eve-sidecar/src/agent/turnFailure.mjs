/**
 * Abort / error emission for one UIMessage turn stream.
 * Owns markFailed + chunk write so runTurn catch sites stay one-liners.
 */

import { isAbortError } from './httpAbort.mjs';

/**
 * @param {{
 *   abortSignal?: AbortSignal,
 *   onFailed: () => void,
 * }} input
 */
export function createTurnFailure(input) {
  const { abortSignal, onFailed } = input;

  /**
   * @param {{ write: (chunk: import('ai').UIMessageChunk) => void }} writer
   */
  function writeAbort(writer) {
    onFailed();
    writer.write({ type: 'abort', reason: 'client aborted' });
  }

  /**
   * @param {{ write: (chunk: import('ai').UIMessageChunk) => void }} writer
   * @param {unknown} error
   * @param {string} [fallbackMessage]
   */
  function writeError(writer, error, fallbackMessage) {
    onFailed();
    writer.write({
      type: 'error',
      errorText:
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : fallbackMessage || String(error),
    });
  }

  /**
   * @param {{ write: (chunk: import('ai').UIMessageChunk) => void }} writer
   * @param {unknown} [error]
   * @returns {'abort' | 'error'}
   */
  function failCaught(writer, error) {
    if (isAbortError(error) || abortSignal?.aborted) {
      writeAbort(writer);
      return 'abort';
    }
    writeError(writer, error);
    return 'error';
  }

  /**
   * Client already aborted before/between work units (no thrown error).
   * @param {{ write: (chunk: import('ai').UIMessageChunk) => void }} writer
   * @returns {boolean} true when aborted and chunk was written
   */
  function failIfAborted(writer) {
    if (!abortSignal?.aborted) return false;
    writeAbort(writer);
    return true;
  }

  return { writeAbort, writeError, failCaught, failIfAborted };
}
