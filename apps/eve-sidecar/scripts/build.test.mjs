/**
 * Seam: scripts/build.mjs → self-contained .output for Tauri resources.
 * After build, the server entry must not reach into repo src/, and must
 * start (listen URL) with only NODE_PATH pointing at .output/node_modules.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, before } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function listMjs(dir, acc = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) listMjs(p, acc);
    else if (name.name.endsWith('.mjs')) acc.push(p);
  }
  return acc;
}

describe('eve-sidecar build (.output packaging)', () => {
  before(async () => {
    const { build } = await import('./build.mjs');
    build();
  });

  it('copies a server entry that does not import repo src/', () => {
    const entry = join(root, '.output', 'server', 'index.mjs');
    const raw = readFileSync(entry, 'utf8');
    assert.doesNotMatch(raw, /\.\.\/\.\.\/src\//);
    for (const file of listMjs(join(root, '.output', 'server'))) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(
        text,
        /\.\.\/\.\.\/src\//,
        `${file} still imports ../../src/`,
      );
    }
  });

  it('vendors production node_modules next to the server entry', () => {
    const nm = join(root, '.output', 'node_modules');
    assert.ok(readdirSync(nm).length > 0, 'expected .output/node_modules');
    assert.ok(
      readdirSync(join(nm, 'ai')).length > 0 ||
        readdirSync(nm).some((n) => n.startsWith('ai')),
      'expected ai package under .output/node_modules',
    );
    for (const pkg of [
      'eve-message',
      'extract-contract',
      'quote-wire',
      'reading-context',
    ]) {
      assert.ok(
        existsSync(join(nm, '@wellread', pkg, 'package.json')),
        `expected vendored @wellread/${pkg}`,
      );
      assert.ok(
        existsSync(join(nm, '@wellread', pkg, 'src')),
        `expected vendored @wellread/${pkg}/src`,
      );
    }
  });

  it('copies bundled-skills next to the server package root', () => {
    const bundled = join(root, '.output', 'bundled-skills');
    const ids = readdirSync(bundled);
    for (const id of ['explain', 'grill-me', 'note', 'socratic-check', 'translate']) {
      assert.ok(ids.includes(id), `expected bundled skill ${id}`);
      assert.ok(
        existsSync(join(bundled, id, 'SKILL.md')),
        `expected ${id}/SKILL.md in .output/bundled-skills`,
      );
    }
    assert.ok(
      existsSync(join(bundled, 'note', 'PACKAGE.md')),
      'expected note/PACKAGE.md in .output/bundled-skills',
    );
    assert.ok(
      existsSync(join(bundled, 'note', 'AGENTS.md')),
      'expected note/AGENTS.md in .output/bundled-skills',
    );
    assert.ok(
      existsSync(join(bundled, 'note', 'tools', 'validate_okf_wiki.py')),
      'expected note/tools/validate_okf_wiki.py in .output/bundled-skills',
    );
  });

  it('starts and prints a loopback listen URL with only packaged modules', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'eve-pack-'));
    const booksDir = mkdtempSync(join(tmpdir(), 'eve-books-'));
    const entry = join(root, '.output', 'server', 'index.mjs');
    const nodePath = join(root, '.output', 'node_modules');
    const child = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        EVE_LOOPBACK_TOKEN: 'pack-test-token',
        EVE_DATA_DIR: dataDir,
        EVE_BOOKS_ROOT: booksDir,
        EVE_MODEL_API_KEY: '',
        NODE_PATH: nodePath,
      },
      cwd: join(root, '.output', 'server'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('listen timeout')), 8000);
        let buf = '';
        child.stdout.on('data', (chunk) => {
          buf += chunk.toString();
          const m = buf.match(/http:\/\/127\.0\.0\.1:\d+/);
          if (m) {
            clearTimeout(timer);
            resolve(m[0]);
          }
        });
        child.stderr.on('data', (chunk) => {
          buf += chunk.toString();
        });
        child.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`exited ${code}: ${buf}`));
        });
      });
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      child.kill('SIGKILL');
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(booksDir, { recursive: true, force: true });
    }
  });
});
