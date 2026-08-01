import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { waitForResponseEnd } from './waitForResponseEnd.mjs';

function fakeRes(overrides = {}) {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  Object.assign(res, overrides);
  return res;
}

describe('waitForResponseEnd', () => {
  it('resolves immediately when writableEnded', async () => {
    const res = fakeRes({ writableEnded: true });
    await waitForResponseEnd(res, { timeoutMs: 50 });
  });

  it('resolves immediately when destroyed (client abort missed finish/close)', async () => {
    const res = fakeRes({ destroyed: true });
    await waitForResponseEnd(res, { timeoutMs: 50 });
  });

  it('resolves on finish', async () => {
    const res = fakeRes();
    const pending = waitForResponseEnd(res, { timeoutMs: 500 });
    queueMicrotask(() => res.emit('finish'));
    await pending;
  });

  it('resolves on close', async () => {
    const res = fakeRes();
    const pending = waitForResponseEnd(res, { timeoutMs: 500 });
    queueMicrotask(() => res.emit('close'));
    await pending;
  });

  it('resolves when destroyed is set after wait starts (no finish/close)', async () => {
    const res = fakeRes();
    const pending = waitForResponseEnd(res, { timeoutMs: 500, pollMs: 10 });
    setTimeout(() => {
      res.destroyed = true;
    }, 20);
    await pending;
  });

  it('resolves on explicit short timeout so the turn gate cannot stick forever', async () => {
    const res = fakeRes();
    const started = Date.now();
    await waitForResponseEnd(res, { timeoutMs: 30, pollMs: 1000 });
    assert.ok(Date.now() - started >= 25);
  });
});
