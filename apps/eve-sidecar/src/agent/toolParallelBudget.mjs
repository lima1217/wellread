/**
 * Per-step parallel tool-call caps (asymmetric read vs write).
 *
 * Read/search tools share one budget; write_file has a higher budget so note
 * skill batch (content pages + indexes + logs) stays legal in one step.
 */

export const MAX_PARALLEL_READ_TOOLS = 8;
export const MAX_PARALLEL_WRITE_TOOLS = 16;

/** @type {ReadonlySet<string>} */
export const READ_PARALLEL_TOOL_NAMES = new Set([
  'read_file',
  'grep',
  'glob',
  'resolve_section',
]);

/** @type {ReadonlySet<string>} */
export const WRITE_PARALLEL_TOOL_NAMES = new Set(['write_file']);

/**
 * @typedef {{
 *   beginStep: () => void,
 *   tryConsume: (toolName: string) =>
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

  return {
    beginStep() {
      readUsed = 0;
      writeUsed = 0;
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
            message: `本 step 最多并行 ${MAX_PARALLEL_READ_TOOLS} 个读/检索工具（read_file / grep / glob / resolve_section）；超出的调用未执行，请分批读取。`,
            limit: MAX_PARALLEL_READ_TOOLS,
            toolName: name,
          };
        }
        return { ok: true };
      }
      return { ok: true };
    },
  };
}

/**
 * Wrap tool execute handlers so excess parallel calls return a soft-fail envelope.
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
        const gate = budget.tryConsume(name);
        if (!gate.ok) {
          return {
            ok: false,
            error: gate.error,
            message: gate.message,
            limit: gate.limit,
            toolName: gate.toolName,
          };
        }
        return execute(input, options);
      },
    };
  }
  return wrapped;
}
