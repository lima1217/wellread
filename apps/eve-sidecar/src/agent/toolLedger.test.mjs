import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SOFT_LANDING_PATHS_MAX } from './toolRounds.mjs';
import { formatToolLedger, formatWriteConfirmation } from './toolLedger.mjs';

describe('formatWriteConfirmation', () => {
  it('formats a single write path', () => {
    assert.equal(
      formatWriteConfirmation([
        { name: 'write_file', args: { path: 'log.md', content: 'x' }, result: { ok: true } },
      ]),
      '已写入：log.md',
    );
  });

  it('dedupes and lists multiple successful writes', () => {
    assert.equal(
      formatWriteConfirmation([
        { name: 'write_file', args: { path: 'a.md' }, result: { ok: true } },
        { name: 'write_file', args: { path: 'a.md' }, result: { ok: true } },
        { name: 'write_file', args: { path: 'b.md' }, result: { ok: true } },
        { name: 'grep', args: { path: 'c.md' } },
      ]),
      '已写入 2 个文件：\n- a.md\n- b.md',
    );
  });

  it('returns empty when writes failed or lack ok', () => {
    assert.equal(formatWriteConfirmation([{ name: 'read_file', args: { path: 'a.md' } }]), '');
    assert.equal(
      formatWriteConfirmation([
        {
          name: 'write_file',
          args: { path: 'denied.md' },
          result: { ok: false, error: 'denied', path: 'denied.md' },
        },
      ]),
      '',
    );
    assert.equal(
      formatWriteConfirmation([{ name: 'write_file', args: { path: 'pending.md' } }]),
      '',
    );
  });
});

describe('formatToolLedger', () => {
  it('lists writes and reads then write handoff line', () => {
    const text = formatToolLedger([
      { name: 'read_file', args: { path: '/r.md' } },
      { name: 'write_file', args: { path: '/w.md' }, result: { ok: true, path: '/w.md' } },
      { name: 'grep', args: { path: '/g.md', pattern: 'x' } },
    ]);
    assert.match(text, /工具调用次数已用尽/);
    assert.match(text, /已写入 1 个文件/);
    assert.match(text, /- \/w\.md/);
    assert.match(text, /已读取 1 个文件/);
    assert.match(text, /- \/r\.md/);
    assert.match(text, /其它工具触及路径/);
    assert.match(text, /继续写入/);
  });

  it('lists failed writes separately and does not claim success', () => {
    const text = formatToolLedger([
      {
        name: 'write_file',
        args: { path: '/bad.md' },
        result: { ok: false, error: 'denied', path: '/bad.md' },
      },
      {
        name: 'write_file',
        args: { path: '/good.md' },
        result: { ok: true, path: '/good.md' },
      },
    ]);
    assert.match(text, /已写入 1 个文件/);
    assert.match(text, /- \/good\.md/);
    assert.match(text, /写入失败 1 个文件/);
    assert.match(text, /- \/bad\.md/);
    assert.equal(text.includes('已写入 2'), false);
    assert.match(text, /继续写入/);
  });

  it('uses a neutral close when there were no writes', () => {
    const text = formatToolLedger([{ name: 'glob', args: { pattern: '**/*' } }]);
    assert.match(text, /共执行 1 次工具调用/);
    assert.match(text, /缩小范围后重试/);
    assert.equal(text.includes('继续写入'), false);
  });

  it('caps listed paths at SOFT_LANDING_PATHS_MAX', () => {
    const over = SOFT_LANDING_PATHS_MAX + 5;
    /** @type {Array<{ name: string, args: { path: string } }>} */
    const toolTrace = [];
    for (let i = 0; i < over; i++) {
      toolTrace.push({ name: 'read_file', args: { path: `/p${i}.md` } });
    }
    const text = formatToolLedger(toolTrace);
    assert.match(text, new RegExp(`已读取 ${over} 个文件`));
    assert.match(text, /- \/p0\.md/);
    assert.match(text, new RegExp(`- /p${SOFT_LANDING_PATHS_MAX - 1}\\.md`));
    assert.equal(text.includes(`/p${SOFT_LANDING_PATHS_MAX}.md`), false);
    assert.match(text, /另有 5 个路径未列出/);
    assert.equal(text.includes('继续写入'), false);
  });
});
