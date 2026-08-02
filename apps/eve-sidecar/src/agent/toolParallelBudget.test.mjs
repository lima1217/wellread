import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_PARALLEL_COMPOSE,
  MAX_PARALLEL_READ_TOOLS,
  MAX_PARALLEL_WRITE_TOOLS,
  composeGate,
  createToolParallelBudget,
  parallelGate,
  wrapToolsWithParallelBudget,
} from './toolParallelBudget.mjs';

describe('createToolParallelBudget', () => {
  it('allows up to 8 read tools then soft-fails', () => {
    const budget = createToolParallelBudget();
    budget.beginStep();
    for (let i = 0; i < MAX_PARALLEL_READ_TOOLS; i += 1) {
      assert.equal(budget.tryConsume('read_file').ok, true);
    }
    const denied = budget.tryConsume('grep');
    assert.equal(denied.ok, false);
    assert.equal(denied.error, 'too_many_parallel_tools');
    assert.equal(denied.limit, MAX_PARALLEL_READ_TOOLS);
  });

  it('allows up to 16 write_file then soft-fails', () => {
    const budget = createToolParallelBudget();
    budget.beginStep();
    for (let i = 0; i < MAX_PARALLEL_WRITE_TOOLS; i += 1) {
      assert.equal(budget.tryConsume('write_file').ok, true);
    }
    const denied = budget.tryConsume('write_file');
    assert.equal(denied.ok, false);
    assert.equal(denied.limit, MAX_PARALLEL_WRITE_TOOLS);
  });

  it('tracks read and write budgets independently', () => {
    const budget = createToolParallelBudget();
    budget.beginStep();
    for (let i = 0; i < MAX_PARALLEL_READ_TOOLS; i += 1) {
      assert.equal(budget.tryConsume('read_file').ok, true);
    }
    assert.equal(budget.tryConsume('read_file').ok, false);
    assert.equal(budget.tryConsume('write_file').ok, true);
  });

  it('resets on beginStep', () => {
    const budget = createToolParallelBudget();
    budget.beginStep();
    for (let i = 0; i < MAX_PARALLEL_READ_TOOLS; i += 1) {
      budget.tryConsume('glob');
    }
    assert.equal(budget.tryConsume('resolve_section').ok, false);
    budget.beginStep();
    assert.equal(budget.tryConsume('resolve_section').ok, true);
  });

  it('does not cap unknown tool names', () => {
    const budget = createToolParallelBudget();
    budget.beginStep();
    for (let i = 0; i < 30; i += 1) {
      assert.equal(budget.tryConsume('lookup').ok, true);
    }
  });

  it('caps draft compose separately from write_file', () => {
    const budget = createToolParallelBudget();
    budget.beginStep();
    for (let i = 0; i < MAX_PARALLEL_COMPOSE; i += 1) {
      assert.equal(budget.tryConsumeCompose().ok, true);
    }
    const denied = budget.tryConsumeCompose();
    assert.equal(denied.ok, false);
    assert.equal(denied.error, 'too_many_parallel_compose');
    assert.equal(denied.limit, MAX_PARALLEL_COMPOSE);
    // Write budget remains independent.
    assert.equal(budget.tryConsume('write_file').ok, true);
  });

  it('resets compose on beginStep', () => {
    const budget = createToolParallelBudget();
    budget.beginStep();
    for (let i = 0; i < MAX_PARALLEL_COMPOSE; i += 1) {
      budget.tryConsumeCompose();
    }
    assert.equal(budget.tryConsumeCompose().ok, false);
    budget.beginStep();
    assert.equal(budget.tryConsumeCompose().ok, true);
  });
});

describe('parallelGate', () => {
  it('returns null when under budget and merges extras on deny', () => {
    const budget = createToolParallelBudget();
    budget.beginStep();
    assert.equal(parallelGate(budget, 'glob'), null);
    for (let i = 1; i < MAX_PARALLEL_READ_TOOLS; i += 1) {
      assert.equal(parallelGate(budget, 'read_file'), null);
    }
    const denied = parallelGate(budget, 'resolve_section', {
      count: 0,
      paths: [],
    });
    assert.equal(denied?.ok, false);
    assert.equal(denied?.error, 'too_many_parallel_tools');
    assert.equal(denied?.count, 0);
    assert.deepEqual(denied?.paths, []);
  });
});

describe('composeGate', () => {
  it('returns null under compose budget and merges extras on deny', () => {
    const budget = createToolParallelBudget();
    budget.beginStep();
    for (let i = 0; i < MAX_PARALLEL_COMPOSE; i += 1) {
      assert.equal(composeGate(budget, { path: `/p${i}` }), null);
    }
    const denied = composeGate(budget, { path: '/over' });
    assert.equal(denied?.ok, false);
    assert.equal(denied?.error, 'too_many_parallel_compose');
    assert.equal(denied?.path, '/over');
  });
});

describe('wrapToolsWithParallelBudget', () => {
  it('blocks excess execute and still runs earlier calls', async () => {
    let ran = 0;
    const budget = createToolParallelBudget();
    budget.beginStep();
    const tools = wrapToolsWithParallelBudget(
      {
        read_file: {
          description: 'read',
          execute: async () => {
            ran += 1;
            return { ok: true };
          },
        },
      },
      budget,
    );

    const results = await Promise.all(
      Array.from({ length: MAX_PARALLEL_READ_TOOLS + 2 }, () =>
        tools.read_file.execute({ path: '/workspace/x.md' }),
      ),
    );

    assert.equal(ran, MAX_PARALLEL_READ_TOOLS);
    assert.equal(results.filter((r) => r.ok === true).length, MAX_PARALLEL_READ_TOOLS);
    assert.equal(
      results.filter((r) => r.error === 'too_many_parallel_tools').length,
      2,
    );
  });
});
