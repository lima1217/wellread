import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createReaderCommandQueue } from './readerCommands.mjs';

describe('reader command queue', () => {
  it('hands a command to the waiting poller of that book and returns its result', async () => {
    const q = createReaderCommandQueue();
    const other = q.take('bk2', { waitMs: 50 });
    const poll = q.take('bk1', { waitMs: 5000 });
    const run = q.run('bk1', 'turn_page', { direction: 'next' });
    const [cmd] = await poll;
    assert.equal(cmd.type, 'turn_page');
    assert.deepEqual(cmd.args, { direction: 'next' });
    assert.equal(q.complete(cmd.id, { ok: true, position: 'p2' }), true);
    assert.deepEqual(await run, { ok: true, position: 'p2' });
    assert.deepEqual(await other, []);
    assert.equal(q.complete(cmd.id, { ok: true }), false); // already settled
  });

  it('queues commands until a poller arrives', async () => {
    const q = createReaderCommandQueue();
    const run = q.run('bk1', 'list_annotations', {});
    const [cmd] = await q.take('bk1', { waitMs: 10 });
    q.complete(cmd.id, { ok: true, annotations: [] });
    assert.equal((await run).ok, true);
  });

  it('times out when no reader answers and drops the queued command', async () => {
    const q = createReaderCommandQueue({ timeoutMs: 20 });
    const res = await q.run('bk1', 'highlight', { text: 'x' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'reader_timeout');
    assert.deepEqual(await q.take('bk1', { waitMs: 10 }), []);
  });

  it('puts commands back when the polling reader disconnects', async () => {
    const q = createReaderCommandQueue();
    const gone = new AbortController();
    const poll = q.take('bk1', { waitMs: 5000, signal: gone.signal });
    gone.abort();
    assert.deepEqual(await poll, []);
    const run = q.run('bk1', 'turn_page', { direction: 'prev' });
    const [cmd] = await q.take('bk1', { waitMs: 10 });
    q.complete(cmd.id, { ok: true });
    assert.equal((await run).ok, true);
  });
});
