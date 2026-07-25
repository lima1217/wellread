import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAnswerContentGate,
  isRecoverableMixedTools,
  pickAnswerFromSteps,
} from './answerContent.mjs';

describe('isRecoverableMixedTools', () => {
  it('allows write_file-only mixed steps', () => {
    assert.equal(isRecoverableMixedTools(['write_file']), true);
  });

  it('rejects research tools and empty lists', () => {
    assert.equal(isRecoverableMixedTools(['grep']), false);
    assert.equal(isRecoverableMixedTools(['write_file', 'grep']), false);
    assert.equal(isRecoverableMixedTools([]), false);
  });
});

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

  it('fallback recovers last step when answer shared write_file', () => {
    const gate = createAnswerContentGate();
    gate.startStep();
    gate.onTextDelta('Saved to notes.');
    gate.onToolCall('write_file');
    gate.finishStep();
    assert.equal(gate.getContent(), '');
    assert.equal(gate.fallbackText(), 'Saved to notes.');
  });

  it('fallback does not recover research-tool narration', () => {
    const gate = createAnswerContentGate();
    gate.startStep();
    gate.onTextDelta('让我继续读。');
    gate.onToolCall('grep');
    gate.finishStep();
    assert.equal(gate.getContent(), '');
    assert.equal(gate.fallbackText(), '');
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

  it('recovers write_file-mixed text when every step had tools', () => {
    assert.equal(
      pickAnswerFromSteps([{ text: 'Saved.', toolCalls: [{ name: 'write_file' }] }]),
      'Saved.',
    );
  });

  it('does not recover grep-mixed narration when every step had tools', () => {
    assert.equal(
      pickAnswerFromSteps([{ text: '让我继续读。', toolCalls: [{ name: 'grep' }] }]),
      '',
    );
  });
});
