import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createLanguageModel,
  normalizeApiMode,
  normalizeModelEnv,
  patchDeepSeekChatBody,
  promoteReasoningContentInPayload,
  withDeepSeekThinkingDisabled,
} from './createModel.mjs';

describe('normalizeModelEnv', () => {
  it('defaults to DeepSeek chat completions', () => {
    assert.deepEqual(normalizeModelEnv({}), {
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: '',
      modelId: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      apiMode: 'chat',
    });
  });

  it('rejects empty modelId after trim by falling back', () => {
    assert.equal(normalizeModelEnv({ modelId: '  ' }).modelId, 'deepseek-v4-flash');
  });

  it('normalizes apiMode', () => {
    assert.equal(normalizeApiMode('responses'), 'responses');
    assert.equal(normalizeApiMode('chat'), 'chat');
    assert.equal(normalizeApiMode('nope'), 'chat');
    assert.equal(normalizeModelEnv({ apiMode: 'responses' }).apiMode, 'responses');
  });
});

describe('withDeepSeekThinkingDisabled', () => {
  it('injects thinking disabled into chat completion JSON bodies', async () => {
    /** @type {string | undefined} */
    let sentBody;
    const wrapped = withDeepSeekThinkingDisabled(async (_url, init) => {
      sentBody = typeof init?.body === 'string' ? init.body : undefined;
      return new Response('{}', { status: 200 });
    });

    await wrapped('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [] }),
    });

    assert.ok(sentBody);
    const parsed = JSON.parse(sentBody);
    assert.deepEqual(parsed.thinking, { type: 'disabled' });
  });

  it('overrides an explicit thinking enabled setting', async () => {
    /** @type {string | undefined} */
    let sentBody;
    const wrapped = withDeepSeekThinkingDisabled(async (_url, init) => {
      sentBody = typeof init?.body === 'string' ? init.body : undefined;
      return new Response('{}', { status: 200 });
    });

    await wrapped('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        thinking: { type: 'enabled' },
      }),
    });

    assert.equal(JSON.parse(/** @type {string} */ (sentBody)).thinking.type, 'disabled');
  });
});

describe('patchDeepSeekChatBody', () => {
  it('rewrites developer role to system and disables thinking', () => {
    assert.deepEqual(
      patchDeepSeekChatBody({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'developer', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
        thinking: { type: 'enabled' },
      }),
      {
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
        thinking: { type: 'disabled' },
      },
    );
  });
});

describe('promoteReasoningContentInPayload', () => {
  it('copies delta.reasoning_content into empty delta.content', () => {
    const out = promoteReasoningContentInPayload({
      choices: [{ delta: { reasoning_content: 'think', content: '' } }],
    });
    assert.deepEqual(out, {
      choices: [{ delta: { reasoning_content: 'think', content: 'think' } }],
    });
  });

  it('leaves non-empty content alone', () => {
    const input = {
      choices: [{ delta: { reasoning_content: 'think', content: 'answer' } }],
    };
    assert.equal(promoteReasoningContentInPayload(input), input);
  });
});

describe('createLanguageModel', () => {
  it('uses provider.chat for the default apiMode', () => {
    const fakeChat = { provider: 'openai.chat', modelId: 'deepseek-v4-flash' };
    const createOpenAI = () => {
      const chat = (modelId) => {
        assert.equal(modelId, 'deepseek-v4-flash');
        return fakeChat;
      };
      const provider = () => {
        throw new Error('default callable is Responses API');
      };
      provider.chat = chat;
      provider.responses = () => {
        throw new Error('should not use responses for chat mode');
      };
      return provider;
    };
    const result = createLanguageModel(normalizeModelEnv({ apiKey: 'sk-test' }), {
      createOpenAI,
    });
    assert.equal(result.model, fakeChat);
    assert.equal(result.modelContextWindowTokens, 1_000_000);
  });

  it('uses provider.responses when apiMode is responses', () => {
    const fakeResponses = { provider: 'openai.responses', modelId: 'gpt-4.1' };
    const createOpenAI = () => {
      const provider = () => {
        throw new Error('prefer provider.responses when available');
      };
      provider.chat = () => {
        throw new Error('should not use chat for responses mode');
      };
      provider.responses = (modelId) => {
        assert.equal(modelId, 'gpt-4.1');
        return fakeResponses;
      };
      return provider;
    };
    const result = createLanguageModel(
      normalizeModelEnv({ apiKey: 'sk-test', modelId: 'gpt-4.1', apiMode: 'responses' }),
      { createOpenAI },
    );
    assert.equal(result.model, fakeResponses);
  });
});
