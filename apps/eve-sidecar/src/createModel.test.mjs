import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createLanguageModel,
  normalizeApiMode,
  normalizeModelEnv,
  normalizeThinkingMode,
  patchChatCompletionBody,
  transformCompletionPayload,
  turnFetchContext,
  withModelFetchPatch,
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

describe('normalizeThinkingMode', () => {
  it('accepts think and defaults everything else to fast', () => {
    assert.equal(normalizeThinkingMode('think'), 'think');
    assert.equal(normalizeThinkingMode('fast'), 'fast');
    assert.equal(normalizeThinkingMode(undefined), 'fast');
    assert.equal(normalizeThinkingMode('nope'), 'fast');
  });
});

describe('patchChatCompletionBody', () => {
  it('rewrites developer role to system and disables thinking in fast mode', () => {
    assert.deepEqual(
      patchChatCompletionBody(
        {
          model: 'glm-5.2',
          messages: [
            { role: 'developer', content: 'sys' },
            { role: 'user', content: 'hi' },
          ],
          thinking: { type: 'enabled' },
        },
        'fast',
      ),
      {
        model: 'glm-5.2',
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'hi' },
        ],
        thinking: { type: 'disabled' },
      },
    );
  });

  it('enables thinking in think mode', () => {
    assert.deepEqual(
      patchChatCompletionBody({ model: 'glm-5.2', messages: [] }, 'think').thinking,
      { type: 'enabled' },
    );
  });
});

describe('transformCompletionPayload', () => {
  it('never copies reasoning into empty content', () => {
    const out = transformCompletionPayload(
      { choices: [{ delta: { reasoning_content: 'think', content: '' } }] },
      { thinkingMode: 'fast' },
    );
    assert.equal(out.choices[0].delta.content, '');
    assert.equal(out.choices[0].delta.reasoning_content, undefined);
  });

  it('leaves answer content alone while forwarding reasoning in think mode', () => {
    /** @type {string[]} */
    const reasoning = [];
    const out = transformCompletionPayload(
      { choices: [{ delta: { reasoning_content: 'step', content: 'answer' } }] },
      {
        thinkingMode: 'think',
        onReasoningDelta: (delta) => reasoning.push(delta),
      },
    );
    assert.deepEqual(reasoning, ['step']);
    assert.equal(out.choices[0].delta.content, 'answer');
    assert.equal(out.choices[0].delta.reasoning_content, undefined);
  });

  it('forwards reasoning-only deltas in think mode without inventing content', () => {
    /** @type {string[]} */
    const reasoning = [];
    const out = transformCompletionPayload(
      { choices: [{ delta: { reasoning_content: 'cot', content: '' } }] },
      {
        thinkingMode: 'think',
        onReasoningDelta: (delta) => reasoning.push(delta),
      },
    );
    assert.deepEqual(reasoning, ['cot']);
    assert.equal(out.choices[0].delta.content, '');
    assert.equal(out.choices[0].delta.reasoning_content, undefined);
  });
});

describe('withModelFetchPatch', () => {
  it('injects thinking disabled when turn context mode is fast', async () => {
    /** @type {string | undefined} */
    let sentBody;
    const wrapped = withModelFetchPatch(async (_url, init) => {
      sentBody = typeof init?.body === 'string' ? init.body : undefined;
      return new Response('{}', { status: 200 });
    });

    await turnFetchContext.run({ thinkingMode: 'fast' }, () =>
      wrapped('https://api.example.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'glm-5.2', messages: [] }),
      }),
    );

    assert.ok(sentBody);
    assert.deepEqual(JSON.parse(sentBody).thinking, { type: 'disabled' });
  });

  it('injects thinking enabled when turn context mode is think', async () => {
    /** @type {string | undefined} */
    let sentBody;
    const wrapped = withModelFetchPatch(async (_url, init) => {
      sentBody = typeof init?.body === 'string' ? init.body : undefined;
      return new Response('{}', { status: 200 });
    });

    await turnFetchContext.run({ thinkingMode: 'think' }, () =>
      wrapped('https://api.example.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'glm-5.2', thinking: { type: 'disabled' } }),
      }),
    );

    assert.equal(JSON.parse(/** @type {string} */ (sentBody)).thinking.type, 'enabled');
  });

  it('keeps each concurrent turn thinkingMode isolated', async () => {
    /** @type {string[]} */
    const thinkingTypes = [];
    const wrapped = withModelFetchPatch(async (_url, init) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      thinkingTypes.push(body.thinking?.type);
      return new Response('{}', { status: 200 });
    });

    const request = (mode) =>
      turnFetchContext.run({ thinkingMode: mode }, () =>
        wrapped('https://api.example.com/v1/chat/completions', {
          method: 'POST',
          body: JSON.stringify({ model: 'glm-5.2', messages: [] }),
        }),
      );

    await Promise.all([request('think'), request('fast')]);

    assert.deepEqual(thinkingTypes.toSorted(), ['disabled', 'enabled']);
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
