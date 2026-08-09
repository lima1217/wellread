/**
 * Path confinement for wellread's Books SandboxBackend.
 *
 * - Model paths are absolute under /workspace
 * - /workspace maps to the Books host directory
 * - Reads: realpath must stay under Books root
 * - Writes: realpath must stay under Books/.wellread/
 */

export const WORKSPACE_ROOT = '/workspace';
export const WRITABLE_DIR = '.wellread';

/** Resolve one path hop for realpath. Pure — caller supplies FS facts. */

export function isWorkspacePath(workspacePath) {
  return workspacePath === WORKSPACE_ROOT || workspacePath.startsWith(`${WORKSPACE_ROOT}/`);
}

/** Join segments without following symlinks; collapses . and .. */
export function normalizeAbsolute(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error(`expected absolute path, got ${path}`);
  }
  // Reject Windows separators / NULs before split — otherwise `\..\` can slip
  // past lexical clamps on Windows hosts when a single segment contains `\`.
  if (path.includes('\\') || path.includes('\0')) {
    throw new Error(`invalid path characters: ${path}`);
  }
  const parts = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) continue;
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return `/${parts.join('/')}`;
}

/**
 * Map /workspace/... → {booksRoot}/...
 * Rejects paths that are not under /workspace (before host mapping).
 */
export function workspaceToHost(workspacePath, booksRoot) {
  const ws = normalizeAbsolute(workspacePath);
  if (!isWorkspacePath(ws)) {
    return { ok: false, reason: `not under ${WORKSPACE_ROOT}: ${workspacePath}` };
  }
  const rel = ws === WORKSPACE_ROOT ? '' : ws.slice(WORKSPACE_ROOT.length + 1);
  const host = normalizeAbsolute(rel ? `${booksRoot}/${rel}` : booksRoot);
  const root = normalizeAbsolute(booksRoot);
  if (host !== root && !host.startsWith(`${root}/`)) {
    return { ok: false, reason: `escaped Books root before realpath: ${host}` };
  }
  return { ok: true, hostPath: host, realPath: host };
}

/**
 * Lexical realpath: walk components, follow symlinks, refuse loops.
 * Final path need not exist as a file (for write-to-create); each
 * prefix used as a symlink source must resolve.
 */
export function realpath(absoluteHostPath, lookup) {
  const input = normalizeAbsolute(absoluteHostPath);
  const seen = new Set();
  let current = input;

  for (let hops = 0; hops < 32; hops++) {
    if (seen.has(current)) {
      return { ok: false, reason: `symlink loop at ${current}` };
    }
    seen.add(current);

    const parts = current.split('/').filter(Boolean);
    let acc = '';
    let redirected = null;

    for (let i = 0; i < parts.length; i++) {
      acc = `${acc}/${parts[i]}`;
      const node = lookup(acc);
      if (node.kind === 'symlink') {
        const target = node.target.startsWith('/')
          ? normalizeAbsolute(node.target)
          : normalizeAbsolute(`${acc.slice(0, acc.lastIndexOf('/')) || ''}/${node.target}`);
        const rest = parts.slice(i + 1);
        redirected = rest.length ? normalizeAbsolute(`${target}/${rest.join('/')}`) : target;
        break;
      }
      if (node.kind === 'missing' && i < parts.length - 1) {
        return { ok: false, reason: `missing path component: ${acc}` };
      }
    }

    if (redirected === null) {
      return { ok: true, hostPath: input, realPath: current };
    }
    current = redirected;
  }

  return { ok: false, reason: 'too many symlink hops' };
}

function underRoot(realPath, root) {
  const r = normalizeAbsolute(root);
  const p = normalizeAbsolute(realPath);
  return p === r || p.startsWith(`${r}/`);
}

/** @param {string} realPath @param {string} root */
export function isPathUnderRoot(realPath, root) {
  return underRoot(realPath, root);
}

export function authorizeRead(workspacePath, booksRoot, lookup) {
  const mapped = workspaceToHost(workspacePath, booksRoot);
  if (!mapped.ok) return mapped;

  const resolved = realpath(mapped.hostPath, lookup);
  if (!resolved.ok) return resolved;

  if (!underRoot(resolved.realPath, booksRoot)) {
    return {
      ok: false,
      reason: `realpath escaped Books root: ${resolved.realPath}`,
    };
  }
  return { ok: true, hostPath: mapped.hostPath, realPath: resolved.realPath };
}

export function authorizeWrite(workspacePath, booksRoot, lookup) {
  const read = authorizeRead(workspacePath, booksRoot, lookup);
  if (!read.ok) return read;

  const writableRoot = normalizeAbsolute(`${booksRoot}/${WRITABLE_DIR}`);
  if (!underRoot(read.realPath, writableRoot)) {
    return {
      ok: false,
      reason: `writes only under ${WORKSPACE_ROOT}/${WRITABLE_DIR}/ (realpath ${read.realPath})`,
    };
  }
  return read;
}

/** Authorize glob/grep roots — must realpath into Books/.wellread/. */
export function authorizeWellreadSearch(workspacePath, booksRoot, lookup) {
  return authorizeWrite(workspacePath, booksRoot, lookup);
}

function dirnameAbsolute(absoluteHostPath) {
  const p = normalizeAbsolute(absoluteHostPath);
  if (p === '/') return '/';
  const idx = p.lastIndexOf('/');
  return idx <= 0 ? '/' : p.slice(0, idx) || '/';
}

/**
 * Before mkdir for a write, authorize the deepest existing path prefix.
 * Blocks `.wellread` symlinks that escape Books from creating outside dirs.
 */
export function authorizeExistingWritePrefix(hostPath, booksRoot, lookup) {
  const root = normalizeAbsolute(booksRoot);
  const writableRoot = normalizeAbsolute(`${booksRoot}/${WRITABLE_DIR}`);
  const target = normalizeAbsolute(hostPath);

  if (!underRoot(target, writableRoot)) {
    return {
      ok: false,
      reason: `writes only under ${WORKSPACE_ROOT}/${WRITABLE_DIR}/`,
    };
  }

  let current = dirnameAbsolute(target);
  while (true) {
    const node = lookup(current);
    if (node.kind !== 'missing') {
      const resolved = realpath(current, lookup);
      if (!resolved.ok) return resolved;
      if (underRoot(resolved.realPath, writableRoot)) {
        return { ok: true, realPath: resolved.realPath };
      }
      // Allow creating `.wellread` itself when only the Books root exists.
      if (
        normalizeAbsolute(resolved.realPath) === root &&
        underRoot(target, writableRoot)
      ) {
        return { ok: true, realPath: resolved.realPath };
      }
      return {
        ok: false,
        reason: `realpath escaped writable root before mkdir: ${resolved.realPath}`,
      };
    }
    if (current === '/' || current === root) {
      return { ok: false, reason: `books root missing: ${root}` };
    }
    const parent = dirnameAbsolute(current);
    if (parent === current) {
      return { ok: false, reason: `books root missing: ${root}` };
    }
    current = parent;
  }
}
