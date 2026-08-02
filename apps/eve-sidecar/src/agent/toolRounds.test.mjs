import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_FINAL_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_TOOL_ROUNDS,
  HARD_FINAL_MAX_OUTPUT_TOKENS,
  HARD_MAX_TOOL_ROUNDS,
  MIN_FINAL_MAX_OUTPUT_TOKENS,
  MIN_MAX_TOOL_ROUNDS,
  TOOLS_EXHAUSTED_SYSTEM_PROMPT,
  prepareToolExhaustionStep,
  resolveFinalMaxOutputTokens,
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

describe('resolveFinalMaxOutputTokens', () => {
  it('defaults to 8192', () => {
    assert.equal(resolveFinalMaxOutputTokens(), DEFAULT_FINAL_MAX_OUTPUT_TOKENS);
    assert.equal(resolveFinalMaxOutputTokens(undefined), 8192);
  });

  it('clamps to 1024–32768', () => {
    assert.equal(resolveFinalMaxOutputTokens(1), MIN_FINAL_MAX_OUTPUT_TOKENS);
    assert.equal(resolveFinalMaxOutputTokens(100_000), HARD_FINAL_MAX_OUTPUT_TOKENS);
    assert.equal(resolveFinalMaxOutputTokens('4096'), 4096);
  });
});

describe('prepareToolExhaustionStep', () => {
  const instructions = 'base instructions';

  it('leaves early steps unchanged', () => {
    assert.equal(
      prepareToolExhaustionStep({
        stepNumber: 0,
        maxToolRounds: 10,
        instructions,
      }),
      undefined,
    );
    assert.equal(
      prepareToolExhaustionStep({
        stepNumber: 9,
        maxToolRounds: 10,
        instructions,
      }),
      undefined,
    );
  });

  it('disables tools and sets native output budget on the landing step', () => {
    const step = prepareToolExhaustionStep({
      stepNumber: 10,
      maxToolRounds: 10,
      instructions,
      maxOutputTokens: 4096,
    });
    assert.ok(step);
    assert.equal(step.toolChoice, 'none');
    assert.deepEqual(step.activeTools, []);
    assert.equal(
      step.instructions,
      `${instructions}\n\n${TOOLS_EXHAUSTED_SYSTEM_PROMPT}`,
    );
    assert.equal(step.maxOutputTokens, 4096);
  });
});
