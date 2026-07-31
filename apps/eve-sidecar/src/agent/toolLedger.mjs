/**
 * Deterministic assistant content from toolTrace — used when soft-landing
 * discards free-form model text, and when write_file confirmations must not
 * recycle progress narration.
 */

/** Cap listed paths in ledger sections (keep answers bounded). */
export const SOFT_LANDING_PATHS_MAX = 80;

/**
 * @param {unknown} args
 * @returns {string}
 */
function pathFromArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const path = /** @type {{ path?: unknown }} */ (args).path;
  return typeof path === 'string' && path.trim() ? path.trim() : '';
}

/**
 * @param {unknown} result
 * @returns {string}
 */
function pathFromResult(result) {
  if (!result || typeof result !== 'object') return '';
  const path = /** @type {{ path?: unknown }} */ (result).path;
  return typeof path === 'string' && path.trim() ? path.trim() : '';
}

/**
 * @param {unknown} result
 * @returns {boolean}
 */
function isOkResult(result) {
  return Boolean(
    result &&
      typeof result === 'object' &&
      /** @type {{ ok?: unknown }} */ (result).ok === true,
  );
}

/**
 * @param {unknown} result
 * @returns {boolean}
 */
function isFailedResult(result) {
  if (!result || typeof result !== 'object') return false;
  const r = /** @type {{ ok?: unknown, error?: unknown }} */ (result);
  if (r.ok === true) return false;
  return r.ok === false || typeof r.error === 'string';
}

/**
 * @param {Array<{ name?: string, args?: unknown, result?: unknown }>} toolTrace
 * @param {string} name
 * @returns {string[]}
 */
function uniquePathsForTool(toolTrace, name) {
  if (!Array.isArray(toolTrace)) return [];
  /** @type {string[]} */
  const paths = [];
  const seen = new Set();
  for (const entry of toolTrace) {
    if (!entry || entry.name !== name) continue;
    const path = pathFromArgs(entry.args);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

/**
 * @param {Array<{ name?: string, args?: unknown, result?: unknown }>} toolTrace
 * @param {'ok' | 'failed'} outcome
 * @returns {string[]}
 */
function uniqueWritePaths(toolTrace, outcome) {
  if (!Array.isArray(toolTrace)) return [];
  /** @type {string[]} */
  const paths = [];
  const seen = new Set();
  for (const entry of toolTrace) {
    if (!entry || entry.name !== 'write_file') continue;
    const result = entry.result;
    const match =
      outcome === 'ok' ? isOkResult(result) : isFailedResult(result);
    if (!match) continue;
    const path = pathFromArgs(entry.args) || pathFromResult(result);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

/**
 * Cap listed paths in ledger sections (keep answers bounded).
 *
 * @param {string[]} paths
 * @returns {{ shown: string[], omitted: number }}
 */
function capPaths(paths) {
  if (paths.length <= SOFT_LANDING_PATHS_MAX) {
    return { shown: paths, omitted: 0 };
  }
  return {
    shown: paths.slice(0, SOFT_LANDING_PATHS_MAX),
    omitted: paths.length - SOFT_LANDING_PATHS_MAX,
  };
}

/**
 * @param {string[]} lines
 * @param {string} heading
 * @param {string[]} paths
 */
function pushPathSection(lines, heading, paths) {
  if (!paths.length) return;
  const { shown, omitted } = capPaths(paths);
  lines.push(heading);
  for (const p of shown) lines.push(`- ${p}`);
  if (omitted > 0) {
    lines.push(`（另有 ${omitted} 个路径未列出）`);
  }
}

/**
 * Short confirmation for successful write_file calls (no model narration).
 *
 * @param {Array<{ name?: string, args?: unknown, result?: unknown }>} toolTrace
 * @returns {string}
 */
export function formatWriteConfirmation(toolTrace) {
  const paths = uniqueWritePaths(toolTrace, 'ok');
  if (paths.length === 0) return '';
  if (paths.length === 1) return `已写入：${paths[0]}`;
  return `已写入 ${paths.length} 个文件：\n${paths.map((p) => `- ${p}`).join('\n')}`;
}

/**
 * Soft-landing body when the tool budget was spent. Ignores model prose.
 *
 * @param {Array<{ name?: string, args?: unknown, result?: unknown }>} toolTrace
 * @returns {string}
 */
export function formatToolLedger(toolTrace) {
  const written = uniqueWritePaths(toolTrace, 'ok');
  const writeFailed = uniqueWritePaths(toolTrace, 'failed');
  const read = uniquePathsForTool(toolTrace, 'read_file');
  /** @type {string[]} */
  const otherPaths = [];
  const seenOther = new Set();
  if (Array.isArray(toolTrace)) {
    for (const entry of toolTrace) {
      if (!entry || typeof entry.name !== 'string') continue;
      if (entry.name === 'write_file' || entry.name === 'read_file') continue;
      const path = pathFromArgs(entry.args);
      if (!path || seenOther.has(path)) continue;
      seenOther.add(path);
      otherPaths.push(path);
    }
  }

  const toolCount = Array.isArray(toolTrace) ? toolTrace.length : 0;
  /** @type {string[]} */
  const lines = [
    '工具调用次数已用尽。本轮按已执行的工具汇总（模型收束正文已忽略）：',
  ];
  pushPathSection(lines, `已写入 ${written.length} 个文件：`, written);
  pushPathSection(lines, `写入失败 ${writeFailed.length} 个文件：`, writeFailed);
  pushPathSection(lines, `已读取 ${read.length} 个文件：`, read);
  pushPathSection(
    lines,
    `其它工具触及路径 ${otherPaths.length} 个：`,
    otherPaths,
  );
  if (
    !written.length &&
    !writeFailed.length &&
    !read.length &&
    !otherPaths.length
  ) {
    lines.push(
      toolCount
        ? `共执行 ${toolCount} 次工具调用（无路径参数）。`
        : '本轮没有可用的工具记录。',
    );
  }
  // Write handoff is note-skill vocabulary; keep it off research-only ledgers.
  if (written.length || writeFailed.length) {
    lines.push('未完成部分请缩小范围，或发送「继续写入」接着做。');
  } else {
    lines.push('未完成部分请缩小范围后重试，或换个更具体的问题接着做。');
  }
  return lines.join('\n');
}
