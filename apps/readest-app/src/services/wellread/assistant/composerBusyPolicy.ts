/**
 * P3-4: while a turn is streaming, the composer stays editable for
 * pre-typing the next message; only submit/Enter is gated on busy.
 */

/** Textarea / typing must remain enabled during an in-flight turn. */
export function isComposerTextInputDisabled(_busy: boolean): boolean {
  return false;
}

/** Enter / Send must not start a new turn while busy. */
export function shouldBlockComposerSubmit(busy: boolean): boolean {
  return busy;
}
