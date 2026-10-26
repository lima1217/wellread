/**
 * Read a one-shot secret the parent wrote to stdin (then closed), so the model
 * API key never sits in the sidecar's environment where `ps -E` can see it.
 */

const MAX_SECRET_BYTES = 64 * 1024;

/**
 * @param {AsyncIterable<Buffer | string>} [stream]
 * @returns {Promise<string>}
 */
export async function readStdinSecret(stream = process.stdin) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_SECRET_BYTES) throw new Error('stdin secret too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}
