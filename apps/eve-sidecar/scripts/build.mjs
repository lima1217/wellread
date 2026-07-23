/**
 * Build a self-contained `.output/` for Tauri `bundle.resources`.
 *
 * Layout:
 *   .output/server/index.mjs (+ sibling server modules, createModel, agent/*, books/*)
 *   .output/bundled-skills/  (default Reading Assistant skill packages)
 *   .output/node_modules/   (production deps via npm, no pnpm symlinks)
 *
 * Entry imports stay relative under `.output/server/` — never `../../src/`.
 */
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = join(root, '.output');
const outServer = join(outRoot, 'server');

function copyRuntimeTree(fromDir, toDir) {
  mkdirSync(toDir, { recursive: true });
  for (const name of readdirSync(fromDir, { withFileTypes: true })) {
    if (name.name.endsWith('.test.mjs')) continue;
    const src = join(fromDir, name.name);
    const dest = join(toDir, name.name);
    if (name.isDirectory()) {
      copyRuntimeTree(src, dest);
    } else if (name.name.endsWith('.mjs')) {
      cpSync(src, dest);
    }
  }
}

/** Rewrite `../x` imports in the server entry to `./x` for the flat server layout. */
function rewriteServerEntry(srcPath, destPath) {
  const raw = readFileSync(srcPath, 'utf8');
  const rewritten = raw
    .replaceAll("from '../createModel.mjs'", "from './createModel.mjs'")
    .replaceAll("from '../agent/", "from './agent/")
    .replaceAll('from "../createModel.mjs"', 'from "./createModel.mjs"')
    .replaceAll('from "../agent/', 'from "./agent/');
  writeFileSync(destPath, rewritten);
}

function installProdNodeModules() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const slim = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: 'module',
    dependencies: pkg.dependencies || {},
  };
  writeFileSync(join(outRoot, 'package.json'), `${JSON.stringify(slim, null, 2)}\n`);
  const result = spawnSync(
    'npm',
    ['install', '--omit=dev', '--no-fund', '--no-audit', '--ignore-scripts'],
    {
      cwd: outRoot,
      stdio: 'inherit',
      env: { ...process.env, npm_config_package_lock: 'false' },
    },
  );
  if (result.status !== 0) {
    throw new Error(`npm install in .output failed with status ${result.status}`);
  }
}

export function build() {
  rmSync(outRoot, { recursive: true, force: true });
  mkdirSync(outServer, { recursive: true });

  cpSync(join(root, 'src', 'createModel.mjs'), join(outServer, 'createModel.mjs'));
  copyRuntimeTree(join(root, 'src', 'agent'), join(outServer, 'agent'));
  copyRuntimeTree(join(root, 'src', 'books'), join(outServer, 'books'));
  // Sibling modules under server/ (readJson, turnInFlight, …) must ship with the entry.
  copyRuntimeTree(join(root, 'src', 'server'), outServer);
  rewriteServerEntry(join(root, 'src', 'server', 'index.mjs'), join(outServer, 'index.mjs'));
  // Read-only default skills: same relative path as repo (…/bundled-skills from agent/skills).
  cpSync(join(root, 'bundled-skills'), join(outRoot, 'bundled-skills'), { recursive: true });
  installProdNodeModules();

  console.log('eve-sidecar build ok:', outServer);
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  build();
}
