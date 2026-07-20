import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLanguageModel, normalizeModelEnv } from './createModel.mjs';

describe('normalizeModelEnv', () => {
  it('defaults to DeepSeek', () => {
    assert.deepEqual(normalizeModelEnv({}), {
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: '',
      modelId: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
    });
  });

  it('rejects empty modelId after trim by falling back', () => {
    assert.equal(normalizeModelEnv({ modelId: '  ' }).modelId, 'deepseek-v4-flash');
  });
});

describe('createLanguageModel', () => {
  it('returns LanguageModel instance + context window, never a string model', () => {
    const fakeModel = { provider: 'openai.chat', modelId: 'deepseek-v4-flash' };
    const createOpenAI = ({ baseURL, apiKey }) => {
      assert.equal(baseURL, 'https://api.deepseek.com/v1');
      assert.equal(apiKey, 'sk-test');
      return (modelId) => {
        assert.equal(modelId, 'deepseek-v4-flash');
        return fakeModel;
      };
    };
    const result = createLanguageModel(
      normalizeModelEnv({ apiKey: 'sk-test' }),
      { createOpenAI },
    );
    assert.equal(result.model, fakeModel);
    assert.notEqual(typeof result.model, 'string');
    assert.equal(result.modelContextWindowTokens, 1_000_000);
  });
});
