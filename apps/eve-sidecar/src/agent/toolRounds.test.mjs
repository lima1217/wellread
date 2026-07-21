import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_MAX_TOOL_ROUNDS,
  HARD_MAX_TOOL_ROUNDS,
  MIN_MAX_TOOL_ROUNDS,
  TOOLS_EXHAUSTED_SYSTEM_PROMPT,
  prepareToolExhaustionStep,
  resolveMaxToolRounds,
} from './toolRounds.mjs';

describe('resolveMaxToolRounds', () => {
  it('defaults to 10', () => {
    assert.equal(resolveMaxToolRounds(), DEFAULT_MAX_TOOL_ROUNDS);
    assert.equal(resolveMaxToolRounds(undefined), 10);
    assert.equal(resolveMaxToolRounds(''), 10);
  });

  it('clamps to 2–24', () => {
    assert.equal(resolveMaxToolRounds(1), MIN_MAX_TOOL_ROUNDS);
    assert.equal(resolveMaxToolRounds(100), HARD_MAX_TOOL_ROUNDS);
    assert.equal(resolveMaxToolRounds('16'), 16);
    assert.equal(resolveMaxToolRounds(10.6), 11);
  });

  it('falls back on non-finite input', () => {
    assert.equal(resolveMaxToolRounds('nope'), DEFAULT_MAX_TOOL_ROUNDS);
    assert.equal(resolveMaxToolRounds(NaN), DEFAULT_MAX_TOOL_ROUNDS);
  });
});

describe('prepareToolExhaustionStep', () => {
  const system = 'base system';

  it('leaves early steps unchanged', () => {
    assert.equal(
      prepareToolExhaustionStep({ stepNumber: 0, maxToolRounds: 10, system }),
      undefined,
    );
    assert.equal(
      prepareToolExhaustionStep({ stepNumber: 9, maxToolRounds: 10, system }),
      undefined,
    );
  });

  it('disables tools and appends exhaustion prompt on the landing step', () => {
    const step = prepareToolExhaustionStep({
      stepNumber: 10,
      maxToolRounds: 10,
      system,
    });
    assert.ok(step);
    assert.equal(step.toolChoice, 'none');
    assert.deepEqual(step.activeTools, []);
    assert.ok(step.system.startsWith(system));
    assert.ok(step.system.includes(TOOLS_EXHAUSTED_SYSTEM_PROMPT));
  });
});
