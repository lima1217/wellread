import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bindTurnFetchPatch,
  createLanguageModel,
  normalizeModelEnv,
  normalizeThinkingMode,
  resolveTurnModelPresentation,
  turnFetchContext,
} from './createModel.mjs';
import {
  adaptResponsesInputItem,
  adaptResponsesOutputItem,
  isResponsesRequest,
  normalizeApiMode,
  patchChatCompletionBody,
  patchResponsesBody,
  THINK_MODE_REASONING_EFFORT,
  shouldAttachNativeWebSearch,
  supportsNativeWebSearch,
  supportsThinkingExtension,
  transformCompletionPayload,
  transformResponsesPayload,
  withModelFetchPatch,
} from './createModel.adapters.mjs';

describe('normalizeModelEnv', () => {
  it('defaults to DeepSeek Responses (native web_search)', () => {
    assert.deepEqual(normalizeModelEnv({}), {
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: '',
      modelId: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      apiMode: 'responses',
    });
  });

  it('rejects empty modelId after trim by falling back', () => {
    assert.equal(normalizeModelEnv({ modelId: '  ' }).modelId, 'deepseek-v4-flash');
  });

  it('normalizes apiMode', () => {
    assert.equal(normalizeApiMode('responses'), 'responses');
    assert.equal(normalizeApiMode('chat'), 'chat');
    assert.equal(normalizeApiMode('nope'), 'chat');
  });

  it('forces DeepSeek hosts to responses even when chat is requested', () => {
    assert.equal(
      normalizeModelEnv({
        baseURL: 'https://api.deepseek.com/v1',
        apiMode: 'chat',
      }).apiMode,
      'responses',
    );
    assert.equal(
      normalizeModelEnv({
        baseURL: 'https://api.openai.com/v1',
        apiMode: 'chat',
      }).apiMode,
      'chat',
    );
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

describe('supportsThinkingExtension', () => {
  it('recognizes DeepSeek and BigModel hosts', () => {
    assert.equal(supportsThinkingExtension('https://api.deepseek.com/v1'), true);
    assert.equal(supportsThinkingExtension('https://api.deepseek.com'), true);
    assert.equal(supportsThinkingExtension('https://open.bigmodel.cn/api/paas/v4'), true);
  });

  it('rejects OpenAI official and unknown hosts', () => {
    assert.equal(supportsThinkingExtension('https://api.openai.com/v1'), false);
    assert.equal(supportsThinkingExtension('https://api.openai.com'), false);
    assert.equal(supportsThinkingExtension('https://api.example.com/v1'), false);
    assert.equal(supportsThinkingExtension('not-a-url'), false);
  });
});

describe('supportsNativeWebSearch / shouldAttachNativeWebSearch', () => {
  it('is DeepSeek-only (not BigModel / OpenAI)', () => {
    assert.equal(supportsNativeWebSearch('https://api.deepseek.com/v1'), true);
    assert.equal(supportsNativeWebSearch('https://api.deepseek.com'), true);
    assert.equal(supportsNativeWebSearch('https://open.bigmodel.cn/api/paas/v4'), false);
    assert.equal(supportsNativeWebSearch('https://api.openai.com/v1'), false);
    assert.equal(supportsNativeWebSearch('not-a-url'), false);
  });

  it('attaches only when DeepSeek host and responses apiMode', () => {
    assert.equal(
      shouldAttachNativeWebSearch({
        baseURL: 'https://api.deepseek.com/v1',
        apiMode: 'responses',
      }),
      true,
    );
    assert.equal(
      shouldAttachNativeWebSearch({
        baseURL: 'https://api.deepseek.com/v1',
        apiMode: 'chat',
      }),
      false,
    );
    assert.equal(
      shouldAttachNativeWebSearch({
        baseURL: 'https://api.openai.com/v1',
        apiMode: 'responses',
      }),
      false,
    );
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

  it('sets reasoning_effort to high in Think and clears it in Fast', () => {
    assert.equal(THINK_MODE_REASONING_EFFORT, 'high');
    assert.equal(
      patchChatCompletionBody({ model: 'glm-5.2', messages: [] }, 'think').reasoning_effort,
      'high',
    );
    const fast = patchChatCompletionBody(
      { model: 'glm-5.2', messages: [], reasoning_effort: 'high' },
      'fast',
    );
    assert.equal('reasoning_effort' in fast, false);
  });

  it('omits thinking when injectThinking is false', () => {
    const out = patchChatCompletionBody(
      {
        model: 'gpt-4.1',
        messages: [{ role: 'developer', content: 'sys' }],
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
      },
      'think',
      { injectThinking: false },
    );
    assert.equal('thinking' in out, false);
    assert.equal('reasoning_effort' in out, false);
    assert.deepEqual(out.messages, [{ role: 'system', content: 'sys' }]);
  });
});

describe('isResponsesRequest', () => {
  it('detects /responses URLs and input-only bodies', () => {
    assert.equal(isResponsesRequest('https://api.deepseek.com/responses'), true);
    assert.equal(
      isResponsesRequest('https://api.deepseek.com/v1/chat/completions'),
      false,
    );
    assert.equal(isResponsesRequest('', { input: 'hi' }), true);
    assert.equal(isResponsesRequest('', { messages: [] }), false);
  });
});

describe('patchResponsesBody', () => {
  it('forces store false and sets reasoning effort from thinking mode', () => {
    const think = patchResponsesBody(
      {
        model: 'deepseek-v4-flash',
        input: 'hi',
        store: true,
        previous_response_id: 'resp_x',
        thinking: { type: 'enabled' },
      },
      'think',
    );
    assert.equal(think.store, false);
    assert.equal(think.previous_response_id, undefined);
    assert.equal(think.thinking, undefined);
    assert.deepEqual(think.reasoning, { effort: 'high' });

    const fast = patchResponsesBody({ model: 'deepseek-v4-flash', input: 'hi' }, 'fast');
    assert.deepEqual(fast.reasoning, { effort: 'none' });
  });

  it('re-injects web_search_call items dropped by the SDK under store:false', () => {
    const patched = patchResponsesBody(
      {
        model: 'deepseek-v4-flash',
        input: [
          { type: 'message', role: 'user', content: 'q1' },
          { type: 'message', role: 'assistant', content: 'a1' },
          { type: 'message', role: 'user', content: 'q2' },
        ],
      },
      'fast',
      {
        webSearchCallsToReplay: [
          { type: 'web_search_call', id: 'ws_1', status: 'completed' },
        ],
      },
    );
    assert.deepEqual(patched.input, [
      { type: 'message', role: 'user', content: 'q1' },
      { type: 'message', role: 'assistant', content: 'a1' },
      { type: 'web_search_call', id: 'ws_1', status: 'completed' },
      { type: 'message', role: 'user', content: 'q2' },
    ]);
  });

  it('rewrites OpenAI summary reasoning items to DeepSeek content when opted in', () => {
    const out = patchResponsesBody(
      {
        model: 'deepseek-v4-flash',
        input: [
          {
            type: 'reasoning',
            id: 'rs_1',
            summary: [{ type: 'summary_text', text: 'step' }],
            encrypted_content: 'enc',
          },
        ],
      },
      'think',
      { adaptDeepSeekReasoning: true },
    );
    assert.deepEqual(out.input[0], {
      type: 'reasoning',
      id: 'rs_1',
      content: [{ type: 'reasoning_text', text: 'step' }],
    });
  });

  it('preserves OpenAI encrypted_content when DeepSeek adapt is off', () => {
    const item = {
      type: 'reasoning',
      id: 'rs_1',
      summary: [{ type: 'summary_text', text: 'step' }],
      encrypted_content: 'enc',
    };
    const out = patchResponsesBody(
      { model: 'gpt-4.1', input: [item] },
      'think',
      { injectThinking: false, adaptDeepSeekReasoning: false },
    );
    assert.equal(out.reasoning, undefined);
    assert.deepEqual(out.input[0], item);
  });
});

describe('adaptResponsesOutputItem / transformResponsesPayload', () => {
  it('maps reasoning content to summary and placeholder encrypted_content', () => {
    assert.deepEqual(
      adaptResponsesOutputItem({
        type: 'reasoning',
        id: 'rs_1',
        content: [{ type: 'reasoning_text', text: 'cot' }],
      }),
      {
        type: 'reasoning',
        id: 'rs_1',
        content: [{ type: 'reasoning_text', text: 'cot' }],
        summary: [{ type: 'summary_text', text: 'cot' }],
        encrypted_content: '',
      },
    );
  });

  it('keeps a real encrypted_content string from the host', () => {
    assert.equal(
      /** @type {{ encrypted_content?: string }} */ (
        adaptResponsesOutputItem({
          type: 'reasoning',
          id: 'rs_1',
          summary: [{ type: 'summary_text', text: 'cot' }],
          encrypted_content: 'enc-blob',
        })
      ).encrypted_content,
      'enc-blob',
    );
  });

  it('rewrites DeepSeek reasoning_text stream events when opted in', () => {
    /** @type {string[]} */
    const deltas = [];
    const out = transformResponsesPayload(
      {
        type: 'response.reasoning_text.delta',
        item_id: 'rs_1',
        delta: 'think',
      },
      {
        thinkingMode: 'think',
        onReasoningDelta: (d) => deltas.push(d),
        adaptDeepSeekReasoning: true,
      },
    );
    assert.deepEqual(deltas, ['think']);
    assert.equal(out.type, 'response.reasoning_summary_text.delta');
    assert.equal(out.summary_index, 0);
  });

  it('leaves OpenAI stream events unchanged when DeepSeek adapt is off', () => {
    const event = {
      type: 'response.reasoning_summary_text.delta',
      delta: 'think',
      summary_index: 0,
    };
    assert.equal(
      transformResponsesPayload(event, { adaptDeepSeekReasoning: false }),
      event,
    );
  });
});

describe('adaptResponsesInputItem', () => {
  it('keeps non-reasoning items unchanged', () => {
    const item = { type: 'function_call', call_id: 'c1', name: 'read_file' };
    assert.equal(adaptResponsesInputItem(item), item);
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
  it('requires deps.getStore', () => {
    assert.throws(
      () => withModelFetchPatch(async () => new Response('{}')),
      /requires deps\.getStore/,
    );
  });

  it('injects thinking disabled when turn context mode is fast', async () => {
    /** @type {string | undefined} */
    let sentBody;
    const wrapped = bindTurnFetchPatch(async (_url, init) => {
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
    const wrapped = bindTurnFetchPatch(async (_url, init) => {
      sentBody = typeof init?.body === 'string' ? init.body : undefined;
      return new Response('{}', { status: 200 });
    });

    await turnFetchContext.run({ thinkingMode: 'think' }, () =>
      wrapped('https://api.example.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'glm-5.2', thinking: { type: 'disabled' } }),
      }),
    );

    const parsed = JSON.parse(/** @type {string} */ (sentBody));
    assert.equal(parsed.thinking.type, 'enabled');
    assert.equal(parsed.reasoning_effort, 'high');
  });

  it('does not inject thinking when injectThinking is false', async () => {
    /** @type {string | undefined} */
    let sentBody;
    const wrapped = bindTurnFetchPatch(
      async (_url, init) => {
        sentBody = typeof init?.body === 'string' ? init.body : undefined;
        return new Response('{}', { status: 200 });
      },
      { injectThinking: false },
    );

    await turnFetchContext.run({ thinkingMode: 'think' }, () =>
      wrapped('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-4.1',
          messages: [],
          thinking: { type: 'enabled' },
        }),
      }),
    );

    assert.ok(sentBody);
    assert.equal('thinking' in JSON.parse(sentBody), false);
  });

  it('keeps each concurrent turn thinkingMode isolated', async () => {
    /** @type {string[]} */
    const thinkingTypes = [];
    const wrapped = bindTurnFetchPatch(async (_url, init) => {
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
  it('uses provider.responses for the default apiMode', () => {
    const fakeResponses = {
      provider: 'openai.responses',
      modelId: 'deepseek-v4-flash',
    };
    const createOpenAI = () => {
      const provider = () => {
        throw new Error('prefer provider.responses when available');
      };
      provider.chat = () => {
        throw new Error('should not use chat for default responses mode');
      };
      provider.responses = (modelId) => {
        assert.equal(modelId, 'deepseek-v4-flash');
        return fakeResponses;
      };
      return provider;
    };
    const result = createLanguageModel(normalizeModelEnv({ apiKey: 'sk-test' }), {
      createOpenAI,
    });
    assert.equal(result.model, fakeResponses);
    assert.equal(result.modelContextWindowTokens, 1_000_000);
    assert.equal(result.apiMode, 'responses');
  });

  it('uses provider.chat when apiMode is chat', () => {
    const fakeChat = { provider: 'openai.chat', modelId: 'gpt-4.1' };
    const createOpenAI = () => {
      const chat = (modelId) => {
        assert.equal(modelId, 'gpt-4.1');
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
    const result = createLanguageModel(
      normalizeModelEnv({
        apiKey: 'sk-test',
        modelId: 'gpt-4.1',
        apiMode: 'chat',
        baseURL: 'https://api.openai.com/v1',
      }),
      { createOpenAI },
    );
    assert.equal(result.model, fakeChat);
  });

  it('wires fetch that omits thinking for OpenAI hosts', async () => {
    /** @type {string | undefined} */
    let sentBody;
    /** @type {typeof fetch | undefined} */
    let patchedFetch;
    const createOpenAI = (opts) => {
      patchedFetch = opts.fetch;
      const provider = () => ({});
      provider.chat = () => ({});
      return provider;
    };
    createLanguageModel(
      normalizeModelEnv({
        apiKey: 'sk-test',
        baseURL: 'https://api.openai.com/v1',
        modelId: 'gpt-4.1',
      }),
      {
        createOpenAI,
        baseFetch: async (_url, init) => {
          sentBody = typeof init?.body === 'string' ? init.body : undefined;
          return new Response('{}', { status: 200 });
        },
      },
    );
    assert.ok(patchedFetch);
    await turnFetchContext.run({ thinkingMode: 'think' }, () =>
      patchedFetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4.1', messages: [] }),
      }),
    );
    assert.ok(sentBody);
    assert.equal('thinking' in JSON.parse(sentBody), false);
  });

  it('wires fetch that still injects thinking for thinking-extension hosts on chat', async () => {
    /** @type {string | undefined} */
    let sentBody;
    /** @type {typeof fetch | undefined} */
    let patchedFetch;
    const createOpenAI = (opts) => {
      patchedFetch = opts.fetch;
      const provider = () => ({});
      provider.chat = () => ({});
      return provider;
    };
    // BigModel keeps chat mode; DeepSeek is forced to responses.
    createLanguageModel(
      normalizeModelEnv({
        apiKey: 'sk-test',
        apiMode: 'chat',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        modelId: 'glm-5.2',
      }),
      {
        createOpenAI,
        baseFetch: async (_url, init) => {
          sentBody = typeof init?.body === 'string' ? init.body : undefined;
          return new Response('{}', { status: 200 });
        },
      },
    );
    assert.ok(patchedFetch);
    await turnFetchContext.run({ thinkingMode: 'fast' }, () =>
      patchedFetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'glm-5.2', messages: [] }),
      }),
    );
    assert.deepEqual(JSON.parse(/** @type {string} */ (sentBody)).thinking, {
      type: 'disabled',
    });
  });

  it('wires Responses fetch that injects reasoning.effort and store:false', async () => {
    /** @type {string | undefined} */
    let sentBody;
    /** @type {typeof fetch | undefined} */
    let patchedFetch;
    const createOpenAI = (opts) => {
      patchedFetch = opts.fetch;
      const provider = () => ({});
      provider.chat = () => ({});
      provider.responses = () => ({});
      return provider;
    };
    createLanguageModel(
      normalizeModelEnv({ apiKey: 'sk-test', apiMode: 'responses' }),
      {
        createOpenAI,
        baseFetch: async (_url, init) => {
          sentBody = typeof init?.body === 'string' ? init.body : undefined;
          return new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    );
    assert.ok(patchedFetch);
    await turnFetchContext.run({ thinkingMode: 'think' }, () =>
      patchedFetch('https://api.deepseek.com/responses', {
        method: 'POST',
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          input: 'hi',
          store: true,
        }),
      }),
    );
    const parsed = JSON.parse(/** @type {string} */ (sentBody));
    assert.equal(parsed.store, false);
    assert.deepEqual(parsed.reasoning, { effort: 'high' });
  });
});

describe('resolveTurnModelPresentation', () => {
  it('keeps chat mode on a single system prompt', () => {
    const out = resolveTurnModelPresentation({
      apiMode: 'chat',
      thinkingMode: 'think',
      system: 'full-system',
      envelope: '<reading_context/>',
      instructions: 'base',
    });
    assert.equal(out.toolSystem, 'full-system');
    assert.deepEqual(out.streamTextOptions, { instructions: 'full-system' });
  });

  it('maps responses mode to envelope + instructions + top-level reasoning', () => {
    const out = resolveTurnModelPresentation({
      apiMode: 'responses',
      thinkingMode: 'think',
      system: 'full-system',
      envelope: '<reading_context/>',
      instructions: 'base',
    });
    assert.equal(out.toolSystem, '<reading_context/>');
    assert.deepEqual(out.streamTextOptions, {
      reasoning: 'high',
      instructions: '<reading_context/>',
      providerOptions: {
        openai: {
          store: false,
          instructions: 'base',
        },
      },
    });
  });

  it('maps responses fast mode to reasoning none', () => {
    const out = resolveTurnModelPresentation({
      apiMode: 'responses',
      thinkingMode: 'fast',
      system: 'full-system',
      envelope: '<reading_context/>',
      instructions: 'base',
    });
    assert.equal(out.streamTextOptions.reasoning, 'none');
    assert.equal(
      /** @type {{ openai?: { reasoningEffort?: unknown } }} */ (
        out.streamTextOptions.providerOptions
      )?.openai?.reasoningEffort,
      undefined,
    );
  });
});
