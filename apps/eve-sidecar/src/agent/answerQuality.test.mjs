import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDegenerateAnswer } from './answerQuality.mjs';

describe('isDegenerateAnswer', () => {
  it('rejects the soft-landing ellipsis / 让我继续 loop shape', () => {
    const chunks = [];
    for (let i = 0; i < 40; i++) {
      chunks.push('…让我继续。……（中间略）…');
    }
    const bad = `（续）… Chapter Eight…首先，让我陈述本章的主题。… BCI…\n\n${chunks.join('\n')}`;
    assert.equal(isDegenerateAnswer(bad), true);
  });

  it('allows a normal chapter summary', () => {
    const good = `第八章 "The Androids Are Us" 讲的是用神经技术增强大脑，以跟上指数级技术变化。
核心论点是生物进化以代为单位，而指数技术以月为单位翻倍，必须借助脑机接口、冥想训练与意识技术同时解决速度与规模问题。
整章从大脑的十年讲到 BCI、神经假体，再到致幻剂与开悟的科学化，并收束到用这些精神技术规模化慈悲。
一句话：用神经技术把大脑升级到与 AI 同步，既不掉队、也不失控。`;
    assert.equal(isDegenerateAnswer(good), false);
  });

  it('allows short replies even with a few ellipses', () => {
    assert.equal(isDegenerateAnswer('答案是……指数型技术。'), false);
  });
});
