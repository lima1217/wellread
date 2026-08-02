/**
 * P3-4: while a turn is streaming, the composer must stay editable for
 * pre-typing the next message; only submit/Enter is gated on busy.
 */
import { describe, expect, it } from 'vitest';
import {
  isComposerTextInputDisabled,
  shouldBlockComposerSubmit,
} from '@/services/wellread/assistant/composerBusyPolicy';

describe('composer busy policy (P3-4)', () => {
  it('never disables the message textarea for busy', () => {
    expect(isComposerTextInputDisabled(false)).toBe(false);
    expect(isComposerTextInputDisabled(true)).toBe(false);
  });

  it('blocks submit while busy and allows it when idle', () => {
    expect(shouldBlockComposerSubmit(true)).toBe(true);
    expect(shouldBlockComposerSubmit(false)).toBe(false);
  });
});
