/**
 * Node-side glob/grep over Books/.wellread/ only (no spawn / no rg child).
 */

import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  WORKSPACE_ROOT,
  WRITABLE_DIR,
  authorizeWellreadSearch,
  normalizeAbsolute,
  workspaceToHost,
} from './scopedFs.mjs';
import { createNodeRealpathLookup } from './nodeLookup.mjs';

function wellreadRoot(booksRoot) {
  return normalizeAbsolute(`${booksRoot}/${WRITABLE_DIR}`);
}

function toWorkspacePath(hostPath, booksRoot) {
  const root = normalizeAbsolute(booksRoot);
  const host = normalizeAbsolute(hostPath);
  if (host === root) return WORKSPACE_ROOT;
  if (!host.startsWith(`${root}/`)) {
    throw new Error(`host path outside Books: ${hostPath}`);
  }
  return `${WORKSPACE_ROOT}/${host.slice(root.length + 1)}`;
}

function resolveSearchRoot(patternOrPath, booksRoot) {
  const lookup = createNodeRealpathLookup();
  const workspacePath = patternOrPath.startsWith('/')
    ? patternOrPath
    : `${WORKSPACE_ROOT}/${WRITABLE_DIR}/${patternOrPath}`;
  // If the caller passed a glob pattern with wildcards, strip to the
  // longest literal prefix directory under .wellread.
  const literal = workspacePath.replace(/[*?[].*$/, '').replace(/\/$/, '') || workspacePath;
  const auth = authorizeWellreadSearch(
    literal === WORKSPACE_ROOT ? `${WORKSPACE_ROOT}/${WRITABLE_DIR}` : literal,
    booksRoot,
    lookup,
  );
  if (!auth.ok) throw new Error(auth.reason);
  return auth.realPath;
}

/**
 * @param {unknown} under
 * @param {string} booksRoot
 * @returns {string[] | null} normalized workspace prefixes, or null when unconstrained
 */
function normalizeUnderPrefixes(under, booksRoot) {
  if (!Array.isArray(under) || under.length === 0) return null;
  const lookup = createNodeRealpathLookup();
  const out = [];
  for (const raw of under) {
    if (typeof raw !== 'string' || !raw) continue;
    let ws;
    try {
      ws = normalizeAbsolute(raw.startsWith('/') ? raw : `${WORKSPACE_ROOT}/${WRITABLE_DIR}/${raw}`);
    } catch {
      continue;
    }
    const auth = authorizeWellreadSearch(ws, booksRoot, lookup);
    if (!auth.ok) continue;
    out.push(ws);
  }
  return out;
}

/**
 * @param {string} wsPath
 * @param {string[]} prefixes
 */
function isUnderPrefixes(wsPath, prefixes) {
  return prefixes.some((p) => wsPath === p || wsPath.startsWith(`${p}/`));
}

/** Very small glob: `*` (segment), `**` (recursive), `?` (one char). */
function globToRegExp(pattern) {
  let i = 0;
  let out = '^';
  while (i < pattern.length) {
    if (pattern.startsWith('**/', i) || (pattern.startsWith('**', i) && i + 2 === pattern.length)) {
      out += '.*';
      i += pattern.startsWith('**/', i) ? 3 : 2;
      continue;
    }
    const c = pattern[i];
    if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if ('\\.[]{}()+-^$|'.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
    i += 1;
  }
  out += '$';
  return new RegExp(out);
}

/**
 * Walk files under `dir` without following symlinks (lstat). A link under
 * `.wellread/` must not pull in Books-root or host paths outside the sandbox.
 */
function walkFiles(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    // Skip symlinks entirely — do not recurse or read through them.
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walkFiles(full, files);
    else if (st.isFile()) files.push(full);
  }
  return files;
}

/**
 * Glob under `.wellread/`. `pattern` is matched against workspace paths
 * (`/workspace/.wellread/...`) or relative to that root.
 * @param {string} booksRoot
 * @param {string} pattern
 * @param {{ under?: string[] }} [options] when set, only walk those workspace prefixes
 */
export function globWellread(booksRoot, pattern, options = {}) {
  const root = normalizeAbsolute(booksRoot);
  const wr = wellreadRoot(root);
  // Reject patterns that clearly target outside .wellread (e.g. /workspace/*.epub).
  const normalizedPattern = pattern.startsWith('/')
    ? normalizeAbsolute(pattern)
    : `${WORKSPACE_ROOT}/${WRITABLE_DIR}/${pattern}`;
  if (
    normalizedPattern !== `${WORKSPACE_ROOT}/${WRITABLE_DIR}` &&
    !normalizedPattern.startsWith(`${WORKSPACE_ROOT}/${WRITABLE_DIR}/`)
  ) {
    throw new Error(`glob only under ${WORKSPACE_ROOT}/${WRITABLE_DIR}/`);
  }

  resolveSearchRoot(
    normalizedPattern.includes('*') ? `${WORKSPACE_ROOT}/${WRITABLE_DIR}` : normalizedPattern,
    root,
  );

  const under = normalizeUnderPrefixes(options.under, root);
  const lookup = createNodeRealpathLookup();
  /** @type {string[]} */
  let walkRoots;
  if (under) {
    walkRoots = [];
    for (const ws of under) {
      const auth = authorizeWellreadSearch(ws, root, lookup);
      if (auth.ok) walkRoots.push(auth.realPath);
    }
  } else {
    walkRoots = [wr];
  }

  const re = globToRegExp(normalizedPattern);
  const hits = [];
  for (const walkRoot of walkRoots) {
    for (const hostPath of walkFiles(walkRoot)) {
      const ws = toWorkspacePath(hostPath, root);
      if (under && !isUnderPrefixes(ws, under)) continue;
      if (re.test(ws)) hits.push({ path: ws });
    }
  }
  return hits.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Grep file contents under `.wellread/`. Returns path + 1-based line + text.
 * @param {string} booksRoot
 * @param {string} pattern
 * @param {{
 *   path?: string,
 *   regex?: boolean,
 *   maxHits?: number,
 *   under?: string[],
 * }} [options]
 */
export function grepWellread(booksRoot, pattern, options = {}) {
  const root = normalizeAbsolute(booksRoot);
  const lookup = createNodeRealpathLookup();
  const under = normalizeUnderPrefixes(options.under, root);
  const maxHits = options.maxHits ?? 200;

  const MAX_PATTERN_LENGTH = 256;
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('invalid_grep_pattern: empty');
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(
      `invalid_grep_pattern: too long (max ${MAX_PATTERN_LENGTH})`,
    );
  }

  let re;
  try {
    if (options.regex === false) {
      re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    } else {
      assertSafeGrepRegex(pattern);
      re = new RegExp(pattern);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      detail.startsWith('invalid_grep_pattern:')
        ? detail
        : `invalid_grep_pattern: ${detail}`,
    );
  }

  /** @type {string[]} */
  let searchWsList;
  if (options.path === undefined) {
    searchWsList = under ?? [`${WORKSPACE_ROOT}/${WRITABLE_DIR}`];
  } else {
    const searchWs =
      options.path.startsWith('/')
        ? options.path
        : `${WORKSPACE_ROOT}/${WRITABLE_DIR}/${options.path}`;
    let normalized;
    try {
      normalized = normalizeAbsolute(searchWs);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }
    if (under && !isUnderPrefixes(normalized, under)) {
      throw new Error('search scoped to the current book extract/notes package');
    }
    searchWsList = [normalized];
  }

  const hits = [];
  for (const searchWs of searchWsList) {
    const auth = authorizeWellreadSearch(searchWs, root, lookup);
    if (!auth.ok) {
      // Explicit path must exist under .wellread; default multi-root book
      // scopes treat a missing notes/extract package as an empty hit set.
      if (options.path !== undefined) throw new Error(auth.reason);
      continue;
    }

    const mapped = workspaceToHost(searchWs, root);
    if (!mapped.ok) {
      if (options.path !== undefined) throw new Error(mapped.reason);
      continue;
    }

    const files = (() => {
      try {
        const st = statSync(auth.realPath);
        if (st.isFile()) return [auth.realPath];
      } catch {
        return [];
      }
      return walkFiles(auth.realPath);
    })();

    for (const hostPath of files) {
      let text;
      try {
        text = readFileSync(hostPath, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!re.test(line)) continue;
        const ws = toWorkspacePath(hostPath, root);
        if (under && !isUnderPrefixes(ws, under)) continue;
        hits.push({
          path: ws,
          line: i + 1,
          text: line,
        });
        if (hits.length >= maxHits) return hits;
      }
    }
  }
  return hits;
}

/**
 * Reject regex shapes that commonly cause catastrophic backtracking (ReDoS).
 * Literal mode bypasses this (pattern is escaped).
 * @param {string} pattern
 */
export function assertSafeGrepRegex(pattern) {
  // Nested quantifiers on a group: (a+)+, (a*)*, (a+){2,}, etc.
  if (/\((?:[^)\\]|\\.)*[+*](?:[^)\\]|\\.)*\)[+*{]/.test(pattern)) {
    throw new Error('invalid_grep_pattern: nested quantifiers are not allowed');
  }
  // Quantified groups that contain alternation: (a|aa)+, (?:x|xx)*.
  if (/\((?:\?:)?(?:[^)\\]|\\.)*\|(?:[^)\\]|\\.)*\)[+*{]/.test(pattern)) {
    throw new Error('invalid_grep_pattern: quantified alternation is not allowed');
  }
  // Adjacent overlapping quantifiers outside groups: a++ / a** (invalid in JS
  // anyway) and classic (x+)+ already covered; also reject possessive-looking
  // backreferences which amplify ReDoS.
  if (/\\[1-9]/.test(pattern)) {
    throw new Error('invalid_grep_pattern: backreferences are not allowed');
  }
}
