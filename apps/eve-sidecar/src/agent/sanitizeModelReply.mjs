/**
 * Strip leaked provider tool-call markup from model prose (DeepSeek DSML, etc.).
 * Soft-landing / Responses turns sometimes emit invoke blocks as output_text.
 */

/** Shown when tools ran but the model left no usable prose. */
export const TOOLS_READY_CONTINUE_HINT =
  '本轮工具结果已就绪，但模型未给出正文。请发送「继续」让我基于已读内容回答。';

/** Fullwidth vertical line used as a DSML wrapper (not Markdown `|`). */
const FULLWIDTH_PIPE = '\uFF5C';

/**
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeLeakedToolMarkup(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  return (
    /tool[_▁\s-]*calls/i.test(text) ||
    /<\s*invoke\b/i.test(text) ||
    /<\/\s*invoke\s*>/i.test(text) ||
    /<\s*parameter\b/i.test(text) ||
    /\|DSML\|/i.test(text) ||
    /tool▁calls/i.test(text) ||
    /redacted_tool_calls/i.test(text)
  );
}

/**
 * Remove leaked tool-call markup; return trimmed prose.
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeModelReplyText(text) {
  if (typeof text !== 'string' || !text) return '';

  let out = text;

  // Fullwidth DSML wrappers only — never plain Markdown table pipes.
  const fw = FULLWIDTH_PIPE;
  out = out.replace(new RegExp(`${fw}{1,2}[^${fw}\\n]{0,80}${fw}{1,2}`, 'g'), ' ');
  // Explicit ASCII DSML / redacted-tool token wrappers.
  out = out.replace(/\|DSML\|/gi, ' ');
  out = out.replace(/\|redacted_tool_calls\|/gi, ' ');

  // <invoke …>…</invoke> blocks (with or without DSML prefixes).
  out = out.replace(/<\s*invoke\b[^>]*>[\s\S]*?<\/\s*invoke\s*>/gi, ' ');
  out = out.replace(/<\s*invoke\b[^>]*>/gi, ' ');
  out = out.replace(/<\/\s*invoke\s*>/gi, ' ');

  // Orphan parameter tags from truncated tool dumps.
  out = out.replace(/<\s*parameter\b[^>]*>[\s\S]*?<\/\s*parameter\s*>/gi, ' ');
  out = out.replace(/<\/?\s*parameter\b[^>]*>/gi, ' ');

  // Bare "tool_calls" / "tool-calls" / "tool_calls>" headers left after tag strip.
  out = out.replace(/\btool[_▁\s-]*calls\b\s*>?/gi, ' ');

  // Leftover markup crumbs (e.g. lone ">" from "tool_calls>").
  out = out.replace(/^[>\s|/\\_-]+$/, '');
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  out = out.trim();
  // If nothing but punctuation/symbols remains, treat as empty.
  if (out && !/[\p{L}\p{N}]/u.test(out)) return '';
  return out;
}

/**
 * Trailing chars held back while streaming so a DSML opener is less likely to
 * flash before quarantine. Tuned for `<invoke` / `tool_calls` prefixes.
 */
export const TEXT_STREAM_HOLDBACK_CHARS = 32;

/**
 * Speculative pass-through for UI text parts: stream deltas with a small
 * holdback; if leaked tool markup appears, quarantine and only emit the
 * sanitized remainder at text-end. Pure-DSML parts are suppressed entirely.
 *
 * @template T
 * @param {ReadableStream<T>} stream
 * @returns {ReadableStream<T>}
 */
export function sanitizeUIMessageTextStream(stream) {
  let open = false;
  /** @type {string | null} */
  let textId = null;
  let buf = '';
  let emitted = '';
  let started = false;
  let quarantine = false;

  /** @param {TransformStreamDefaultController<T>} controller */
  function reset() {
    open = false;
    textId = null;
    buf = '';
    emitted = '';
    started = false;
    quarantine = false;
  }

  /**
   * @param {TransformStreamDefaultController<T>} controller
   * @param {string} text
   */
  function emitDelta(controller, text) {
    if (!text || textId == null) return;
    if (!started) {
      controller.enqueue(/** @type {T} */ ({ type: 'text-start', id: textId }));
      started = true;
    }
    controller.enqueue(
      /** @type {T} */ ({ type: 'text-delta', id: textId, delta: text }),
    );
    emitted += text;
  }

  /** @param {TransformStreamDefaultController<T>} controller */
  function flushSafe(controller) {
    if (quarantine || textId == null) return;
    const safeLen = Math.max(0, buf.length - TEXT_STREAM_HOLDBACK_CHARS);
    if (emitted.length >= safeLen) return;
    emitDelta(controller, buf.slice(emitted.length, safeLen));
  }

  /**
   * @param {TransformStreamDefaultController<T>} controller
   */
  function finishTextPart(controller) {
    const id = textId;
    const wasBuf = buf;
    const clean = sanitizeModelReplyText(wasBuf);
    const wasStarted = started;
    const wasEmitted = emitted;
    const wasQuarantine = quarantine;
    reset();
    if (id == null) return;

    if (wasQuarantine) {
      if (!wasStarted) {
        if (!clean) return;
        controller.enqueue(/** @type {T} */ ({ type: 'text-start', id }));
        controller.enqueue(
          /** @type {T} */ ({ type: 'text-delta', id, delta: clean }),
        );
        controller.enqueue(/** @type {T} */ ({ type: 'text-end', id }));
        return;
      }
      if (clean.startsWith(wasEmitted)) {
        const rest = clean.slice(wasEmitted.length);
        if (rest) {
          controller.enqueue(
            /** @type {T} */ ({ type: 'text-delta', id, delta: rest }),
          );
        }
      } else if (!wasEmitted && clean) {
        controller.enqueue(
          /** @type {T} */ ({ type: 'text-delta', id, delta: clean }),
        );
      }
      controller.enqueue(/** @type {T} */ ({ type: 'text-end', id }));
      return;
    }

    // Clean path: flush holdback as raw (sanitize is identity for normal prose).
    const rest = wasBuf.slice(wasEmitted.length);
    if (!wasStarted) {
      if (!rest && !clean) return;
      const delta = rest || clean;
      if (!delta) return;
      controller.enqueue(/** @type {T} */ ({ type: 'text-start', id }));
      controller.enqueue(
        /** @type {T} */ ({ type: 'text-delta', id, delta }),
      );
      controller.enqueue(/** @type {T} */ ({ type: 'text-end', id }));
      return;
    }
    if (rest) {
      controller.enqueue(
        /** @type {T} */ ({ type: 'text-delta', id, delta: rest }),
      );
    }
    controller.enqueue(/** @type {T} */ ({ type: 'text-end', id }));
  }

  return stream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (!chunk || typeof chunk !== 'object') {
          controller.enqueue(chunk);
          return;
        }
        const row = /** @type {{ type?: string, id?: string, delta?: string }} */ (
          chunk
        );
        if (row.type === 'text-start') {
          open = true;
          textId = typeof row.id === 'string' ? row.id : null;
          buf = '';
          emitted = '';
          started = false;
          quarantine = false;
          return;
        }
        if (row.type === 'text-delta' && open) {
          buf += typeof row.delta === 'string' ? row.delta : '';
          if (!quarantine && looksLikeLeakedToolMarkup(buf)) {
            quarantine = true;
            return;
          }
          flushSafe(controller);
          return;
        }
        if (row.type === 'text-end' && open) {
          finishTextPart(controller);
          return;
        }
        controller.enqueue(chunk);
      },
      flush(controller) {
        if (open) finishTextPart(controller);
      },
    }),
  );
}

/**
 * Sanitize text parts on a UI message in place; return cleaned joined text.
 *
 * @param {{ parts?: unknown[] } | null | undefined} msg
 * @returns {string}
 */
export function sanitizeUIMessageTextParts(msg) {
  if (!msg || !Array.isArray(msg.parts)) return '';
  for (const part of msg.parts) {
    if (!part || typeof part !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (part);
    if (row.type !== 'text' || typeof row.text !== 'string') continue;
    row.text = sanitizeModelReplyText(row.text);
  }
  return msg.parts
    .filter((p) => p && typeof p === 'object' && /** @type {any} */ (p).type === 'text')
    .map((p) => /** @type {{ text?: string }} */ (p).text ?? '')
    .join('')
    .trim();
}

/**
 * Ensure the UI message has visible prose when tools ran but text was empty/DSML.
 *
 * @param {{ parts?: unknown[], id?: string } | null | undefined} msg
 * @param {string} hint
 * @returns {void}
 */
export function ensureContinueHintOnMessage(msg, hint = TOOLS_READY_CONTINUE_HINT) {
  if (!msg) return;
  if (!Array.isArray(msg.parts)) msg.parts = [];
  const hasText = msg.parts.some((p) => {
    if (!p || typeof p !== 'object') return false;
    const row = /** @type {Record<string, unknown>} */ (p);
    return row.type === 'text' && typeof row.text === 'string' && row.text.trim();
  });
  if (hasText) return;
  msg.parts.push({ type: 'text', text: hint, state: 'done' });
}
