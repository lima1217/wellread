import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDeepSeekApiHost } from './modelHost.mjs';

describe('isDeepSeekApiHost', () => {
  it('recognizes DeepSeek hosts', () => {
    assert.equal(isDeepSeekApiHost('https://api.deepseek.com/v1'), true);
    assert.equal(isDeepSeekApiHost('https://api.deepseek.com'), true);
    assert.equal(isDeepSeekApiHost('https://region.deepseek.com/v1'), true);
  });

  it('rejects other hosts and junk', () => {
    assert.equal(isDeepSeekApiHost('https://api.openai.com/v1'), false);
    assert.equal(isDeepSeekApiHost('https://open.bigmodel.cn/api/paas/v4'), false);
    assert.equal(isDeepSeekApiHost('not-a-url'), false);
    assert.equal(isDeepSeekApiHost(''), false);
    assert.equal(isDeepSeekApiHost(null), false);
  });
});
