import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createUIMessageStream } from 'ai';
import { createReasoningEmitter } from './reasoningEmitter.mjs';

/**
 * createUIMessageStream only runs processUIMessageStream (and can throw on
 * orphan reasoning chunks) when `onFinish` is set — same as runTurn.
 * @param {(helpers: { writer: { write: (c: Record<string, unknown>) => void } }) => void} execute
 */
async function consumeWithOnFinish(execute) {
  const stream = createUIMessageStream({
    execute,
    onFinish: async () => {},
  });
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

describe('createReasoningEmitter', () => {
  it('reproduces AI SDK crash when reasoning continues after finish-step without a new segment', async () => {
    await assert.rejects(
      () =>
        consumeWithOnFinish(({ writer }) => {
          writer.write({ type: 'start', messageId: 'a1' });
          writer.write({ type: 'reasoning-start', id: 'reasoning_a1' });
          writer.write({
            type: 'reasoning-delta',
            id: 'reasoning_a1',
            delta: 'step1 ',
          });
          writer.write({ type: 'finish-step' });
          writer.write({
            type: 'reasoning-delta',
            id: 'reasoning_a1',
            delta: 'step2',
          });
          writer.write({ type: 'finish' });
        }),
      (err) =>
        err instanceof TypeError &&
        /Cannot read properties of undefined/.test(err.message),
    );
  });

  it('survives finish-step when each segment gets a fresh reasoning id', async () => {
    await consumeWithOnFinish(({ writer }) => {
      const reasoning = createReasoningEmitter(writer, { baseId: 'reasoning_a1' });
      writer.write({ type: 'start', messageId: 'a1' });
      reasoning.writeDelta('step1 ');
      writer.write({ type: 'finish-step' });
      reasoning.beginNewSegment();
      reasoning.writeDelta('step2');
      reasoning.stop();
      writer.write({ type: 'text-start', id: 't1' });
      writer.write({ type: 'text-delta', id: 't1', delta: 'hi' });
      writer.write({ type: 'text-end', id: 't1' });
      writer.write({ type: 'finish' });
    });
  });

  it('ignores deltas after stop', () => {
    /** @type {unknown[]} */
    const writes = [];
    const reasoning = createReasoningEmitter(
      { write: (chunk) => writes.push(chunk) },
      { baseId: 'reasoning_x' },
    );
    reasoning.writeDelta('a');
    reasoning.stop();
    reasoning.writeDelta('b');
    assert.equal(
      writes.filter((c) => /** @type {{ type?: string }} */ (c).type === 'reasoning-delta')
        .length,
      1,
    );
  });
});
