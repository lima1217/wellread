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
  // Client fetch abort closes the socket; `close` also fires on normal end,
  // so only abort when the handler has not settled yet.
  res.on('close', () => {
    if (!settled) trigger();
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
