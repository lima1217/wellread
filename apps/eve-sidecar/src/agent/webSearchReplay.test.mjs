import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectWebSearchCallsForReplay,
  collectWebSearchCallsFromToolTraces,
  injectWebSearchCallsIntoInput,
  isWebSearchToolName,
  mergeWebSearchCalls,
} from './webSearchReplay.mjs';

describe('isWebSearchToolName', () => {
  it('matches OpenAI / DeepSeek web search tool names', () => {
    assert.equal(isWebSearchToolName('web_search'), true);
    assert.equal(isWebSearchToolName('openai.web_search'), true);
    assert.equal(isWebSearchToolName('web_search_preview'), true);
    assert.equal(isWebSearchToolName('grep'), false);
  });
});

describe('collectWebSearchCallsForReplay', () => {
  it('collects providerExecuted web_search tool-calls in order', () => {
    const calls = collectWebSearchCallsForReplay([
      { role: 'user', content: 'q1' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'ws_1',
            toolName: 'web_search',
            providerExecuted: true,
            input: {},
          },
          { type: 'text', text: 'a1' },
        ],
      },
      { role: 'user', content: 'q2' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'ws_2',
            toolName: 'openai.web_search',
            providerExecuted: true,
            input: {},
          },
          {
            type: 'tool-call',
            toolCallId: 'ws_1',
            toolName: 'web_search',
            providerExecuted: true,
            input: {},
          },
        ],
      },
    ]);
    assert.deepEqual(calls, [
      { type: 'web_search_call', id: 'ws_1', status: 'completed' },
      { type: 'web_search_call', id: 'ws_2', status: 'completed' },
    ]);
  });

  it('ignores local function tools', () => {
    const calls = collectWebSearchCallsForReplay([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tc_1',
            toolName: 'grep',
            input: { q: 'x' },
          },
        ],
      },
    ]);
    assert.deepEqual(calls, []);
  });
});

describe('collectWebSearchCallsFromToolTraces', () => {
  it('reads denormalized session tools when modelMessages omit search', () => {
    const calls = collectWebSearchCallsFromToolTraces([
      {
        role: 'assistant',
        tools: [
          { id: 'ws_legacy', name: 'web_search', args: {} },
          { id: 't_grep', name: 'grep', args: { q: 'x' } },
        ],
      },
    ]);
    assert.deepEqual(calls, [
      { type: 'web_search_call', id: 'ws_legacy', status: 'completed' },
    ]);
  });
});

describe('mergeWebSearchCalls', () => {
  it('mutates the target array so ALS fetch patch sees later appends', () => {
    const target = collectWebSearchCallsForReplay([]);
    mergeWebSearchCalls(target, [
      { type: 'web_search_call', id: 'ws_1', status: 'completed' },
    ]);
    mergeWebSearchCalls(target, [
      { type: 'web_search_call', id: 'ws_1', status: 'completed' },
      { type: 'web_search_call', id: 'ws_2', status: 'completed' },
    ]);
    assert.deepEqual(target, [
      { type: 'web_search_call', id: 'ws_1', status: 'completed' },
      { type: 'web_search_call', id: 'ws_2', status: 'completed' },
    ]);
  });
});

describe('injectWebSearchCallsIntoInput', () => {
  it('inserts missing calls before the latest user message', () => {
    const input = [
      { type: 'message', role: 'user', content: 'q1' },
      { type: 'message', role: 'assistant', content: 'a1' },
      { type: 'message', role: 'user', content: 'q2' },
    ];
    const next = injectWebSearchCallsIntoInput(input, [
      { type: 'web_search_call', id: 'ws_1', status: 'completed' },
    ]);
    assert.deepEqual(next, [
      { type: 'message', role: 'user', content: 'q1' },
      { type: 'message', role: 'assistant', content: 'a1' },
      { type: 'web_search_call', id: 'ws_1', status: 'completed' },
      { type: 'message', role: 'user', content: 'q2' },
    ]);
  });

  it('does not duplicate ids already present', () => {
    const input = [
      { type: 'web_search_call', id: 'ws_1', status: 'completed' },
      { role: 'user', content: 'q' },
    ];
    const next = injectWebSearchCallsIntoInput(input, [
      { type: 'web_search_call', id: 'ws_1', status: 'completed' },
      { type: 'web_search_call', id: 'ws_2', status: 'completed' },
    ]);
    assert.deepEqual(next, [
      { type: 'web_search_call', id: 'ws_1', status: 'completed' },
      { type: 'web_search_call', id: 'ws_2', status: 'completed' },
      { role: 'user', content: 'q' },
    ]);
  });
});
