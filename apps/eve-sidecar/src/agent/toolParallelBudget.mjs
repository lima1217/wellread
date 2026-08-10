/**
 * Per-step parallel tool-call caps (asymmetric read vs write vs compose).
 *
 * Read/search tools share one budget; write_file has a higher budget so note
 * skill batch (content pages + indexes + logs) stays legal in one step.
 * Nested LLM compose for write_file(draft) has a tighter cap so batch ingest
 * cannot fan out into O(writes × retries) provider calls.
 */

export const MAX_PARALLEL_READ_TOOLS = 8;
export const MAX_PARALLEL_WRITE_TOOLS = 16;
/** Max concurrent write_file(draft) compose calls per step (nested generateText). */
export const MAX_PARALLEL_COMPOSE = 4;

/** @type {ReadonlySet<string>} */
export const READ_PARALLEL_TOOL_NAMES = new Set([
  'read_file',
  'grep',
  'glob',
  'resolve_section',
  'read_section_text',
]);

/** @type {ReadonlySet<string>} */
export const WRITE_PARALLEL_TOOL_NAMES = new Set(['write_file']);

/**
 * @typedef {{
 *   beginStep: () => void,
 *   tryConsume: (toolName: string) =>
 *     | { ok: true }
 *     | { ok: false, error: string, message: string, limit: number, toolName: string },
 *   tryConsumeCompose: () =>
 *     | { ok: true }
 *     | { ok: false, error: string, message: string, limit: number, toolName: string },
 * }} ToolParallelBudget
 */

/**
 * @returns {ToolParallelBudget}
 */
export function createToolParallelBudget() {
  let readUsed = 0;
  let writeUsed = 0;
  let composeUsed = 0;

  return {
    beginStep() {
      readUsed = 0;
      writeUsed = 0;
      composeUsed = 0;
    },

    tryConsume(toolName) {
      const name = typeof toolName === 'string' ? toolName : '';
      if (WRITE_PARALLEL_TOOL_NAMES.has(name)) {
        writeUsed += 1;
        if (writeUsed > MAX_PARALLEL_WRITE_TOOLS) {
          return {
            ok: false,
            error: 'too_many_parallel_tools',
            message: `本 step 最多并行 ${MAX_PARALLEL_WRITE_TOOLS} 个 write_file；超出的调用未执行，请分批写入。`,
            limit: MAX_PARALLEL_WRITE_TOOLS,
            toolName: name,
          };
        }
        return { ok: true };
      }
      if (READ_PARALLEL_TOOL_NAMES.has(name)) {
        readUsed += 1;
        if (readUsed > MAX_PARALLEL_READ_TOOLS) {
          return {
            ok: false,
            error: 'too_many_parallel_tools',
            message: `本 step 最多并行 ${MAX_PARALLEL_READ_TOOLS} 个读/检索工具（read_file / grep / glob / resolve_section / read_section_text）；超出的调用未执行，请分批读取。`,
            limit: MAX_PARALLEL_READ_TOOLS,
            toolName: name,
          };
        }
        return { ok: true };
      }
      return { ok: true };
    },

    tryConsumeCompose() {
      composeUsed += 1;
      if (composeUsed > MAX_PARALLEL_COMPOSE) {
        return {
          ok: false,
          error: 'too_many_parallel_compose',
          message: `本 step 最多并行 ${MAX_PARALLEL_COMPOSE} 个 write_file(draft) 结构化合成；超出的调用未执行，请分批合成后再写。`,
          limit: MAX_PARALLEL_COMPOSE,
          toolName: 'write_file',
        };
      }
      return { ok: true };
    },
  };
}

/**
 * Shared soft-fail gate for per-step parallel budgets.
 * Returns null when the call may proceed; otherwise a denied envelope.
 * Tool-specific fields (hits/paths/…) go in `extras` so wrapper and
 * production execute paths stay shape-compatible.
 *
 * @template {Record<string, unknown>} [Extras={}]
 * @param {ToolParallelBudget} budget
 * @param {string} toolName
 * @param {Extras} [extras]
 * @returns {null | ({
 *   ok: false,
 *   error: string,
 *   message: string,
 *   limit: number,
 *   toolName: string,
 * } & Extras)}
 */
export function parallelGate(budget, toolName, extras) {
  const gate = budget.tryConsume(toolName);
  if (gate.ok) return null;
  return {
    ok: false,
    error: gate.error,
    message: gate.message,
    limit: gate.limit,
    toolName: gate.toolName,
    ...(extras ?? /** @type {Extras} */ ({})),
  };
}

/**
 * Soft-fail gate for nested write_file(draft) compose concurrency.
 *
 * @template {Record<string, unknown>} [Extras={}]
 * @param {ToolParallelBudget} budget
 * @param {Extras} [extras]
 * @returns {null | ({
 *   ok: false,
 *   error: string,
 *   message: string,
 *   limit: number,
 *   toolName: string,
 * } & Extras)}
 */
export function composeGate(budget, extras) {
  const gate = budget.tryConsumeCompose();
  if (gate.ok) return null;
  return {
    ok: false,
    error: gate.error,
    message: gate.message,
    limit: gate.limit,
    toolName: gate.toolName,
    ...(extras ?? /** @type {Extras} */ ({})),
  };
}

/**
 * Wrap tool execute handlers so excess parallel calls return a soft-fail envelope.
 * Production turns bind budget via toolsContext (`bindTurnTools`); this
 * wrapper is a unit-test / adapter helper for tools without contextSchema.
 *
 * @param {import('ai').ToolSet} tools
 * @param {ToolParallelBudget} budget
 * @returns {import('ai').ToolSet}
 */
export function wrapToolsWithParallelBudget(tools, budget) {
  /** @type {import('ai').ToolSet} */
  const wrapped = {};
  for (const [name, def] of Object.entries(tools)) {
    if (!def || typeof def !== 'object') {
      wrapped[name] = def;
      continue;
    }
    const toolDef = /** @type {Record<string, unknown>} */ (def);
    const execute = toolDef.execute;
    if (typeof execute !== 'function') {
      wrapped[name] = def;
      continue;
    }
    wrapped[name] = {
      ...toolDef,
      execute: async (input, options) => {
        const blocked = parallelGate(budget, name);
        if (blocked) return blocked;
        return execute(input, options);
      },
    };
  }
  return wrapped;
}
