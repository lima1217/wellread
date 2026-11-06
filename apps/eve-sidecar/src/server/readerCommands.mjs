/**
 * Reader commands: actions an external agent asks the open reader to perform
 * (navigate, highlight, annotate, bookmark, …). The sidecar cannot touch the
 * reader UI, so MCP tool calls enqueue a command here and wait; the reader
 * window showing that book long-polls GET /eve/v1/reader/commands, runs the
 * command with the same code paths as the user's own actions, and posts the
 * result back.
 */

import { randomBytes } from 'node:crypto';

export const COMMAND_TIMEOUT_MS = 20_000;
export const POLL_WAIT_MS = 25_000;

/**
 * @typedef {{ id: string, bookId: string, type: string, args: Record<string, unknown> }} ReaderCommand
 * @typedef {{ ok: boolean, [key: string]: unknown }} ReaderCommandResult
 */

/**
 * @param {{ timeoutMs?: number }} [opts]
 */
export function createReaderCommandQueue(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? COMMAND_TIMEOUT_MS;
  /** @type {ReaderCommand[]} */
  const pending = [];
  /** @type {Map<string, { resolve: (r: ReaderCommandResult) => void, timer: NodeJS.Timeout }>} */
  const waiting = new Map();
  /** @type {Set<{ bookId: string, wake: () => void }>} */
  const pollers = new Set();

  /**
   * Queue a command for the reader showing `bookId` and wait for its result.
   * @param {string} bookId
   * @param {string} type
   * @param {Record<string, unknown>} args
   * @returns {Promise<ReaderCommandResult>}
   */
  function run(bookId, type, args) {
    const command = { id: `cmd_${randomBytes(6).toString('hex')}`, bookId, type, args };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(command.id);
        const queued = pending.indexOf(command);
        if (queued >= 0) pending.splice(queued, 1);
        resolve({
          ok: false,
          error: 'reader_timeout',
          message:
            'Wellread did not respond. Make sure the book is still open in Wellread, then retry.',
        });
      }, timeoutMs);
      waiting.set(command.id, { resolve, timer });
      pending.push(command);
      for (const p of pollers) if (p.bookId === bookId) p.wake();
    });
  }

  /** @param {string} bookId */
  function takeNow(bookId) {
    const out = [];
    for (let i = 0; i < pending.length; ) {
      if (pending[i].bookId === bookId) out.push(...pending.splice(i, 1));
      else i += 1;
    }
    return out;
  }

  /**
   * Long-poll: resolve with this book's commands as soon as there are any,
   * or [] after `waitMs` / when `signal` aborts (client went away).
   * @param {string} bookId
   * @param {{ waitMs?: number, signal?: AbortSignal }} [o]
   * @returns {Promise<ReaderCommand[]>}
   */
  function take(bookId, o = {}) {
    const now = takeNow(bookId);
    if (now.length) return Promise.resolve(now);
    return new Promise((resolve) => {
      const poller = {
        bookId,
        wake: () => finish(takeNow(bookId)),
      };
      const timer = setTimeout(() => finish([]), o.waitMs ?? POLL_WAIT_MS);
      const onAbort = () => finish([]);
      function finish(/** @type {ReaderCommand[]} */ cmds) {
        clearTimeout(timer);
        o.signal?.removeEventListener('abort', onAbort);
        pollers.delete(poller);
        if (o.signal?.aborted) {
          // The reader went away mid-poll: its commands wait for the next one.
          pending.unshift(...cmds);
          resolve([]);
          return;
        }
        resolve(cmds);
      }
      o.signal?.addEventListener('abort', onAbort, { once: true });
      pollers.add(poller);
    });
  }

  /**
   * @param {string} id
   * @param {unknown} result
   * @returns {boolean} false when the command is unknown or already timed out
   */
  function complete(id, result) {
    const w = waiting.get(id);
    if (!w) return false;
    waiting.delete(id);
    clearTimeout(w.timer);
    w.resolve(
      result && typeof result === 'object'
        ? /** @type {ReaderCommandResult} */ (result)
        : { ok: false, error: 'bad_result' },
    );
    return true;
  }

  return { run, take, complete };
}
