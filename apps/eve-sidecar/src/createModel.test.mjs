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
  normalizeHostKey,
  patchChatCompletionBody,
  patchResponsesBody,
  THINK_MODE_REASONING_EFFORT,
  shouldAttachNativeWebSearch,
  supportsNativeWebSearch,
  transformCompletionPayload,
  transformResponsesPayload,
  withModelFetchPatch,
} from './createModel.adapters.mjs';

describe('normalizeHostKey', () => {
  it('lowercases the hostname for stable comparison', () => {
    assert.equal(normalizeHostKey('https://Api.DEEPSEEK.com/v1'), 'api.deepseek.com');
  });

  it('ignores paths and trailing slashes', () => {
    assert.equal(normalizeHostKey('https://api.deepseek.com/v1/'), 'api.deepseek.com');
    assert.equal(normalizeHostKey('https://api.deepseek.com'), 'api.deepseek.com');
  });

  it('returns empty for missing or unparsable input', () => {
    assert.equal(normalizeHostKey(''), '');
    assert.equal(normalizeHostKey(undefined), '');
    assert.equal(normalizeHostKey(null), '');
    assert.equal(normalizeHostKey('not a url'), '');
  });
});

describe('normalizeModelEnv', () => {
  it('defaults to the generic chat-completions apiMode', () => {
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
  });

  it('keeps the user-selected apiMode regardless of host', () => {
    assert.equal(
      normalizeModelEnv({
        baseURL: 'https://api.deepseek.com/v1',
        apiMode: 'chat',
      }).apiMode,
      'chat',
    );
    assert.equal(
      normalizeModelEnv({
        baseURL: 'https://api.openai.com/v1',
        apiMode: 'chat',
      }).apiMode,
      'chat',
    );
    assert.equal(
      normalizeModelEnv({
        baseURL: 'https://opencode.ai/zen/go/v1',
        apiMode: 'responses',
      }).apiMode,
      'responses',
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

describe('supportsNativeWebSearch / shouldAttachNativeWebSearch', () => {
  it('is DeepSeek + opencode.ai, not BigModel / OpenAI', () => {
    assert.equal(supportsNativeWebSearch('https://api.deepseek.com/v1'), true);
    assert.equal(supportsNativeWebSearch('https://api.deepseek.com'), true);
    assert.equal(supportsNativeWebSearch('https://opencode.ai/zen/go/v1'), true);
    assert.equal(supportsNativeWebSearch('https://eu.opencode.ai/zen/go/v1'), true);
    assert.equal(supportsNativeWebSearch('https://open.bigmodel.cn/api/paas/v4'), false);
    assert.equal(supportsNativeWebSearch('https://api.openai.com/v1'), false);
    assert.equal(supportsNativeWebSearch('https://notopencode.ai/v1'), false);
    assert.equal(supportsNativeWebSearch('not-a-url'), false);
  });

  it('attaches only when a supporting host is on responses apiMode', () => {
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
        baseURL: 'https://opencode.ai/zen/go/v1',
        apiMode: 'responses',
      }),
      true,
    );
    assert.equal(
      shouldAttachNativeWebSearch({
        baseURL: 'https://opencode.ai/zen/go/v1',
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
  it('rewrites developer role to system and never injects thinking fields', () => {
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
        },
      );
    assert.equal('thinking' in patchChatCompletionBody({ model: 'glm-5.2', messages: [] }), false);
  });

  it('always strips reasoning_effort and thinking from chat bodies', () => {
    assert.equal(THINK_MODE_REASONING_EFFORT, 'high');
    const out = patchChatCompletionBody(
      { model: 'glm-5.2', messages: [], reasoning_effort: 'high' },
    );
    assert.equal('thinking' in out, false);
    assert.equal('reasoning_effort' in out, false);
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

  it('rewrites history reasoning items to DeepSeek content when dialect is deepseek', () => {
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
      { reasoningDialect: 'deepseek' },
    );
    assert.deepEqual(out.input[0], {
      type: 'reasoning',
      id: 'rs_1',
      content: [{ type: 'reasoning_text', text: 'step' }],
    });
  });

  it('preserves OpenAI-shaped history items when dialect is unknown or openai', () => {
    const item = {
      type: 'reasoning',
      id: 'rs_1',
      summary: [{ type: 'summary_text', text: 'step' }],
      encrypted_content: 'enc',
    };
    const out = patchResponsesBody(
      { model: 'gpt-4.1', input: [item] },
      'think',
      {},
    );
    assert.deepEqual(out.reasoning, { effort: 'high' });
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

  it('rewrites DeepSeek reasoning_text stream events by shape alone', () => {
    /** @type {string[]} */
    const deltas = [];
    /** @type {string[]} */
    const dialects = [];
    const out = transformResponsesPayload(
      {
        type: 'response.reasoning_text.delta',
        item_id: 'rs_1',
        delta: 'think',
      },
      {
        thinkingMode: 'think',
        onReasoningDelta: (d) => deltas.push(d),
        onDialect: (d) => dialects.push(d),
      },
    );
    assert.deepEqual(deltas, ['think']);
    assert.deepEqual(dialects, ['deepseek']);
    assert.equal(out.type, 'response.reasoning_summary_text.delta');
    assert.equal(out.summary_index, 0);
  });

  it('leaves OpenAI summary stream events unchanged and records the dialect', () => {
    const event = {
      type: 'response.reasoning_summary_text.delta',
      delta: 'think',
      summary_index: 0,
    };
    /** @type {string[]} */
    const dialects = [];
    assert.equal(
      transformResponsesPayload(event, { onDialect: (d) => dialects.push(d) }),
      event,
    );
    assert.deepEqual(dialects, ['openai']);
  });

  it('adapts third-party gateway responses without any host allowlist', () => {
    /** @type {string[]} */
    const deltas = [];
    const out = transformResponsesPayload(
      {
        type: 'response.reasoning_text.delta',
        item_id: 'rs_1',
        delta: 'step',
      },
      {
        thinkingMode: 'think',
        onReasoningDelta: (d) => deltas.push(d),
      },
    );
    assert.deepEqual(deltas, ['step']);
    assert.equal(out.type, 'response.reasoning_summary_text.delta');
  });

  it('captures real web_search_call items from non-streaming output', () => {
    /** @type {unknown[]} */
    const captured = [];
    const realItem = {
      type: 'web_search_call',
      id: 'ws_1',
      status: 'completed',
      action: { type: 'search', query: 'q1', results: [] },
    };
    transformResponsesPayload(
      {
        id: 'resp_1',
        output: [
          {
            type: 'reasoning',
            id: 'rs_1',
            content: [{ type: 'reasoning_text', text: 'cot' }],
          },
          realItem,
        ],
      },
      { webSearchCallsToReplay: captured },
    );
    assert.deepEqual(captured, [realItem]);
  });

  it('captures real web_search_call items from stream events', () => {
    /** @type {unknown[]} */
    const captured = [];
    const realItem = {
      type: 'web_search_call',
      id: 'ws_1',
      status: 'completed',
      action: { type: 'search', query: 'q1', results: [] },
    };
    transformResponsesPayload(
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: realItem,
      },
      { webSearchCallsToReplay: captured },
    );
    assert.deepEqual(captured, [realItem]);
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

  it('never injects thinking fields on chat bodies', async () => {
    /** @type {string | undefined} */
    let sentBody;
    const wrapped = bindTurnFetchPatch(async (_url, init) => {
      sentBody = typeof init?.body === 'string' ? init.body : undefined;
      return new Response('{}', { status: 200 });
    });

    await turnFetchContext.run({ thinkingMode: 'fast' }, () =>
      wrapped('https://api.example.com/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'glm-5.2',
          messages: [],
          thinking: { type: 'disabled' },
        }),
      }),
    );

    assert.ok(sentBody);
    assert.equal('thinking' in JSON.parse(sentBody), false);
  });

  it('sets reasoning.effort from thinking mode on responses bodies', async () => {
    /** @type {string | undefined} */
    let sentBody;
    const wrapped = bindTurnFetchPatch(async (_url, init) => {
      sentBody = typeof init?.body === 'string' ? init.body : undefined;
      return new Response('{}', { status: 200 });
    });

    await turnFetchContext.run({ thinkingMode: 'think' }, () =>
      wrapped('https://api.example.com/responses', {
        method: 'POST',
        body: JSON.stringify({ model: 'glm-5.2', input: 'hi' }),
      }),
    );

    const parsed = JSON.parse(/** @type {string} */ (sentBody));
    assert.deepEqual(parsed.reasoning, { effort: 'high' });
  });

  it('keeps each concurrent turn reasoning.effort isolated', async () => {
    /** @type {string[]} */
    const efforts = [];
    const wrapped = bindTurnFetchPatch(async (_url, init) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      efforts.push(body.reasoning?.effort);
      return new Response('{}', { status: 200 });
    });

    const request = (mode) =>
      turnFetchContext.run({ thinkingMode: mode }, () =>
        wrapped('https://api.example.com/responses', {
          method: 'POST',
          body: JSON.stringify({ model: 'glm-5.2', input: 'hi' }),
        }),
      );

    await Promise.all([request('think'), request('fast')]);

    assert.deepEqual(efforts.toSorted(), ['high', 'none']);
  });

  it('records the upstream reasoning dialect onto the turn store', async () => {
    /** @type {typeof fetch | undefined} */
    let patchedFetch;
    const wrapped = bindTurnFetchPatch(async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: ' +
                JSON.stringify({
                  type: 'response.reasoning_text.delta',
                  item_id: 'rs_1',
                  delta: 'think',
                }) +
                '\n\ndata: [DONE]\n',
            ),
          );
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    patchedFetch = wrapped;

    const store = { thinkingMode: 'think' };
    const response = await turnFetchContext.run(store, () =>
      patchedFetch('https://opencode.ai/zen/go/v1/responses', {
        method: 'POST',
        body: JSON.stringify({ model: 'deepseek-v4-flash', input: 'hi' }),
      }),
    );
    await /** @type {Response} */ (response).text();

    assert.equal(store.reasoningDialect, 'deepseek');
  });

  it('captures real web_search_call items and replays them with action', async () => {
    /** @type {string[]} */
    const sentBodies = [];
    const realItem = {
      type: 'web_search_call',
      id: 'ws_1',
      status: 'completed',
      action: { type: 'search', query: 'q1', results: [{ title: 't' }] },
    };
    const wrapped = bindTurnFetchPatch(async (_url, init) => {
      sentBodies.push(typeof init?.body === 'string' ? init.body : '');
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'response.output_item.done',
                output_index: 0,
                item: realItem,
              })}\n\ndata: [DONE]\n`,
            ),
          );
          controller.close();
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const store = { thinkingMode: 'fast', webSearchCallsToReplay: [] };
    await turnFetchContext.run(store, () =>
      wrapped('https://opencode.ai/zen/go/v1/responses', {
        method: 'POST',
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          input: [{ role: 'user', content: 'q1' }],
        }),
      }).then((/** @type {Response} */ r) => r.text()),
    );

    assert.deepEqual(store.webSearchCallsToReplay, [realItem]);

    // Second request in the same turn re-injects the captured item verbatim.
    await turnFetchContext.run(store, () =>
      wrapped('https://opencode.ai/zen/go/v1/responses', {
        method: 'POST',
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          input: [{ type: 'message', role: 'user', content: 'q2' }],
        }),
      }).then((/** @type {Response} */ r) => r.text()),
    );

    const parsed = JSON.parse(sentBodies[1]);
    assert.ok(
      parsed.input.some(
        (item) =>
          item.type === 'web_search_call' &&
          item.id === 'ws_1' &&
          item.action?.type === 'search',
      ),
    );
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
        throw new Error('should not use responses for default chat mode');
      };
      return provider;
    };
    const result = createLanguageModel(normalizeModelEnv({ apiKey: 'sk-test' }), {
      createOpenAI,
    });
    assert.equal(result.model, fakeChat);
    assert.equal(result.modelContextWindowTokens, 1_000_000);
    assert.equal(result.apiMode, 'chat');
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

  it('wires fetch that never injects thinking even for thinking-extension hosts', async () => {
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
    // Any host, any mode: no proprietary thinking field on chat bodies.
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
    assert.equal('thinking' in JSON.parse(/** @type {string} */ (sentBody)), false);
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
