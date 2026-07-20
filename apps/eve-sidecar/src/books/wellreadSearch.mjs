/**
 * Node-side glob/grep over Books/.wellread/ only (no spawn / no rg child).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
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
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(full, files);
    else if (st.isFile()) files.push(full);
  }
  return files;
}

/**
 * Glob under `.wellread/`. `pattern` is matched against workspace paths
 * (`/workspace/.wellread/...`) or relative to that root.
 */
export function globWellread(booksRoot, pattern) {
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

  const re = globToRegExp(normalizedPattern);
  const hits = [];
  for (const hostPath of walkFiles(wr)) {
    const ws = toWorkspacePath(hostPath, root);
    if (re.test(ws)) hits.push({ path: ws });
  }
  return hits.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Grep file contents under `.wellread/`. Returns path + 1-based line + text.
 */
export function grepWellread(booksRoot, pattern, options = {}) {
  const root = normalizeAbsolute(booksRoot);
  const lookup = createNodeRealpathLookup();
  const searchWs =
    options.path === undefined
      ? `${WORKSPACE_ROOT}/${WRITABLE_DIR}`
      : options.path.startsWith('/')
        ? options.path
        : `${WORKSPACE_ROOT}/${WRITABLE_DIR}/${options.path}`;

  const auth = authorizeWellreadSearch(searchWs, root, lookup);
  if (!auth.ok) throw new Error(auth.reason);

  const mapped = workspaceToHost(searchWs, root);
  if (!mapped.ok) throw new Error(mapped.reason);

  const re =
    options.regex === false
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : new RegExp(pattern);

  const maxHits = options.maxHits ?? 200;
  const hits = [];
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
      hits.push({
        path: toWorkspacePath(hostPath, root),
        line: i + 1,
        text: line,
      });
      if (hits.length >= maxHits) return hits;
      re.lastIndex = 0;
    }
  }
  return hits;
}
