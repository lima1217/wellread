/** Bounded JSON body reader for the loopback HTTP server. */

export const MAX_JSON_BODY_BYTES = 1_000_000;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('request_body_too_large');
    this.name = 'RequestBodyTooLargeError';
    this.code = 'REQUEST_BODY_TOO_LARGE';
  }
}

export class BadJsonError extends Error {
  /** @param {unknown} [cause] */
  constructor(cause) {
    super('bad_json');
    this.name = 'BadJsonError';
    this.code = 'BAD_JSON';
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * @param {import('node:http').IncomingMessage | AsyncIterable<Uint8Array | Buffer | string>} req
 * @param {{ maxBytes?: number }} [options]
 */
export async function readJson(req, { maxBytes = MAX_JSON_BODY_BYTES } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      // Drain the rest without destroy() so the handler can still send 413.
      for await (const _ of req) {
        // discard
      }
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new BadJsonError(cause);
  }
}
