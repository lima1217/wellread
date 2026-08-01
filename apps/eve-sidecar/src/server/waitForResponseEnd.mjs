/**
 * Wait until an HTTP response has ended (or was torn down by client abort).
 * Always resolves — used so per-session turnGate.release cannot hang forever.
 *
 * Default backstop is long (streaming LLM turns often exceed minutes). A short
 * poll catches Tauri plugin-http cancels that set `destroyed` without emitting
 * finish/close before listeners attach.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {{ timeoutMs?: number, pollMs?: number }} [opts]
 * @returns {Promise<void>}
 */
export function waitForResponseEnd(res, opts = {}) {
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 30 * 60 * 1000;
  const pollMs = typeof opts.pollMs === 'number' ? opts.pollMs : 50;
  return new Promise((resolve) => {
    // Tauri plugin-http cancel often destroys the socket before finish/close
    // listeners are attached; treat destroyed like already-ended.
    if (res.writableEnded || res.destroyed) {
      resolve();
      return;
    }

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      res.off('finish', done);
      res.off('close', done);
      resolve();
    };

    const timer = setTimeout(done, timeoutMs);
    const poll = setInterval(() => {
      if (res.writableEnded || res.destroyed) done();
    }, pollMs);
    res.on('finish', done);
    res.on('close', done);
  });
}
