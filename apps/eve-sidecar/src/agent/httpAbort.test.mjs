import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { createHttpAbort, isAbortError } from './httpAbort.mjs';

describe('createHttpAbort', () => {
  it('aborts when the request is aborted before settle', () => {
    const req = new EventEmitter();
    const res = new EventEmitter();
    const { signal, settle } = createHttpAbort(req, res);

    assert.equal(signal.aborted, false);
    req.emit('aborted');
    assert.equal(signal.aborted, true);
    settle();
  });

  it('aborts when the response closes before settle (client disconnect)', () => {
    const req = new EventEmitter();
    const res = new EventEmitter();
    res.writableEnded = false;
    const { signal } = createHttpAbort(req, res);

    res.emit('close');
    assert.equal(signal.aborted, true);
  });

  it('aborts when the request closes before settle (client disconnect)', () => {
    const req = new EventEmitter();
    const res = new EventEmitter();
    res.writableEnded = false;
    const { signal } = createHttpAbort(req, res);

    req.emit('close');
    assert.equal(signal.aborted, true);
  });

  it('does not abort on close after a successful response end', () => {
    const req = new EventEmitter();
    const res = new EventEmitter();
    res.writableEnded = true;
    const { signal } = createHttpAbort(req, res);

    res.emit('close');
    req.emit('close');
    assert.equal(signal.aborted, false);
  });

  it('does not abort on response close after settle', () => {
    const req = new EventEmitter();
    const res = new EventEmitter();
    const { signal, settle } = createHttpAbort(req, res);

    settle();
    res.emit('close');
    assert.equal(signal.aborted, false);
  });

  it('does not abort on request close after settle', () => {
    const req = new EventEmitter();
    const res = new EventEmitter();
    const { signal, settle } = createHttpAbort(req, res);

    settle();
    req.emit('close');
    assert.equal(signal.aborted, false);
  });
});

describe('isAbortError', () => {
  it('detects AbortError by name', () => {
    const err = new Error('This operation was aborted');
    err.name = 'AbortError';
    assert.equal(isAbortError(err), true);
  });

  it('rejects unrelated errors', () => {
    assert.equal(isAbortError(new Error('Model returned an empty reply')), false);
    assert.equal(isAbortError(null), false);
  });
});
