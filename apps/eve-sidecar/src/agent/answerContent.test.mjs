import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAnswerContentGate,
  pickAnswerFromSteps,
} from './answerContent.mjs';

describe('createAnswerContentGate', () => {
  it('drops text that shares a step with tool calls', () => {
    /** @type {string[]} */
    const deltas = [];
    const gate = createAnswerContentGate((d) => deltas.push(d));

    gate.startStep();
    gate.onTextDelta('让我继续读。');
    gate.onToolCall('grep');
    gate.finishStep();

    gate.startStep();
    gate.onTextDelta('指数型技术。');
    gate.finishStep();

    assert.equal(gate.getContent(), '指数型技术。');
    assert.deepEqual(deltas, ['指数型技术。']);
  });

  it('keeps a single tool-free answer step', () => {
    const gate = createAnswerContentGate();
    gate.startStep();
    gate.onTextDelta('Hello');
    gate.finishStep();
    assert.equal(gate.getContent(), 'Hello');
  });

  it('does not promote soft-landing text when promote is false', () => {
    const gate = createAnswerContentGate();
    gate.startStep();
    gate.onTextDelta('正在写入 claims/index.md。'.repeat(20));
    gate.finishStep({ promote: false });
    assert.equal(gate.getContent(), '');
  });

  it('does not recover write_file narration via fallback (removed)', () => {
    const gate = createAnswerContentGate();
    gate.startStep();
    gate.onTextDelta('Saved to notes.');
    gate.onToolCall('write_file');
    gate.finishStep();
    assert.equal(gate.getContent(), '');
  });
});

describe('pickAnswerFromSteps', () => {
  it('prefers the last tool-free step', () => {
    assert.equal(
      pickAnswerFromSteps([
        { text: 'narration', toolCalls: [{ name: 'grep' }] },
        { text: 'answer', toolCalls: [] },
      ]),
      'answer',
    );
  });

  it('does not recover write_file-mixed narration', () => {
    assert.equal(
      pickAnswerFromSteps([{ text: 'Saved.', toolCalls: [{ name: 'write_file' }] }]),
      '',
    );
  });

  it('does not recover grep-mixed narration when every step had tools', () => {
    assert.equal(
      pickAnswerFromSteps([{ text: '让我继续读。', toolCalls: [{ name: 'grep' }] }]),
      '',
    );
  });
});
