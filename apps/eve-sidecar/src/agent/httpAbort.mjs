/**
 * Bind an AbortSignal to an HTTP request/response pair so client disconnect
 * cancels in-flight AI SDK work (streamText / tools).
 */

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {{ signal: AbortSignal, settle: () => void }}
 */
export function createHttpAbort(req, res) {
  const ac = new AbortController();
  let settled = false;

  const trigger = () => {
    if (settled || ac.signal.aborted) return;
    ac.abort();
  };

  const settle = () => {
    settled = true;
  };

  req.on('aborted', trigger);
  // Tauri plugin-http cancel often closes the socket without Node's legacy
  // `req.aborted` event; `req`/`res` `close` still fire on disconnect.
  // Successful responses also emit `close` after `end` — skip when the
  // response already finished writing (`writableEnded`), otherwise the success
  // path races settle() and spuriously aborts onFinish / dropUser.
  req.on('close', () => {
    if (settled || res.writableEnded) return;
    trigger();
  });
  res.on('close', () => {
    if (settled || res.writableEnded) return;
    trigger();
  });

  return { signal: ac.signal, settle };
}

/**
 * @param {unknown} error
 */
export function isAbortError(error) {
  if (!error || typeof error !== 'object') return false;
  const name = /** @type {{ name?: string }} */ (error).name;
  if (name === 'AbortError') return true;
  // AI SDK / undici sometimes wrap abort as a plain Error with this message.
  const message = /** @type {{ message?: string }} */ (error).message || '';
  return /abort(ed)?/i.test(message) && !/empty reply/i.test(message);
}
