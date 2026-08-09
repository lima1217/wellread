/**
 * Vendor Node 24.x into Tauri externalBin path.
 *
 * Destination: apps/readest-app/src-tauri/binaries/node-<triple>
 * Spec: 10 §1.2 / 05 §2.1 — Node 24.x official binary, Tauri triple naming.
 *
 * Usage:
 *   node scripts/vendor-node.mjs                 # host arch (default aarch64)
 *   node scripts/vendor-node.mjs --triple x86_64-apple-darwin
 */
import {
  createWriteStream,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  mkdtempSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const NODE_MAJOR = 24;

const TRIPLE_TO_PLATFORM = {
  'aarch64-apple-darwin': 'darwin-arm64',
  'x86_64-apple-darwin': 'darwin-x64',
};

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');
const destDir = join(repoRoot, 'apps/readest-app/src-tauri/binaries');

function resolveTriple(argTriple) {
  if (argTriple) {
    if (!TRIPLE_TO_PLATFORM[argTriple]) {
      throw new Error(
        `unsupported triple ${argTriple}; expected one of ${Object.keys(TRIPLE_TO_PLATFORM).join(', ')}`,
      );
    }
    return argTriple;
  }
  return process.arch === 'x64' ? 'x86_64-apple-darwin' : 'aarch64-apple-darwin';
}

async function latestNode24Version() {
  const res = await fetch('https://nodejs.org/dist/index.json');
  if (!res.ok) throw new Error(`nodejs dist index: ${res.status}`);
  const list = await res.json();
  const hit = list.find((row) => row.version.startsWith(`v${NODE_MAJOR}.`));
  if (!hit) throw new Error(`no Node ${NODE_MAJOR}.x on nodejs.org/dist`);
  return hit.version;
}

async function download(url, filePath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: ${res.status}`);
  await pipeline(res.body, createWriteStream(filePath));
}

/**
 * Verify tarball against nodejs.org SHASUMS256.txt for the same version.
 * @param {string} tarballPath
 * @param {string} version e.g. v24.x.y
 * @param {string} tarball file name
 */
async function verifyTarballSha256(tarballPath, version, tarball) {
  const sumUrl = `https://nodejs.org/dist/${version}/SHASUMS256.txt`;
  const res = await fetch(sumUrl);
  if (!res.ok) throw new Error(`nodejs SHASUMS256: ${res.status}`);
  const body = await res.text();
  const line = body.split(/\r?\n/).find((row) => row.endsWith(`  ${tarball}`));
  if (!line) throw new Error(`SHASUMS256 missing entry for ${tarball}`);
  const expected = line.slice(0, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new Error(`invalid SHASUMS256 line for ${tarball}`);
  }
  const actual = createHash('sha256').update(readFileSync(tarballPath)).digest('hex');
  if (actual !== expected) {
    throw new Error(`SHA-256 mismatch for ${tarball}: expected ${expected}, got ${actual}`);
  }
}

export async function vendorNode({ force = false, triple } = {}) {
  const resolvedTriple = resolveTriple(triple);
  const platform = TRIPLE_TO_PLATFORM[resolvedTriple];
  const destBin = join(destDir, `node-${resolvedTriple}`);

  mkdirSync(destDir, { recursive: true });
  if (!force && existsSync(destBin)) {
    try {
      // Cross-arch binaries may not execute on this host; accept by file presence.
      if (resolvedTriple.includes(process.arch === 'arm64' ? 'aarch64' : 'x86_64')) {
        const ver = execFileSync(destBin, ['-v'], { encoding: 'utf8' }).trim();
        if (ver.startsWith(`v${NODE_MAJOR}.`)) {
          console.log(`vendored node already present (${ver}) → ${destBin}`);
          return { version: ver, path: destBin, skipped: true, triple: resolvedTriple };
        }
      } else {
        console.log(`vendored node already present → ${destBin}`);
        return { version: null, path: destBin, skipped: true, triple: resolvedTriple };
      }
    } catch {
      // fall through to re-download
    }
  }
  const version = await latestNode24Version();
  const tarball = `node-${version}-${platform}.tar.gz`;
  const url = `https://nodejs.org/dist/${version}/${tarball}`;
  const staging = mkdtempSync(join(tmpdir(), 'wellread-node-'));
  const tarballPath = join(staging, tarball);

  console.log(`vendoring ${url}`);
  await download(url, tarballPath);
  await verifyTarballSha256(tarballPath, version, tarball);
  execFileSync('tar', ['-xzf', tarballPath, '-C', staging], { stdio: 'inherit' });
  const extracted = join(staging, `node-${version}-${platform}`, 'bin', 'node');
  if (!existsSync(extracted)) {
    throw new Error(`extracted node missing at ${extracted}`);
  }
  rmSync(destBin, { force: true });
  execFileSync('cp', [extracted, destBin], { stdio: 'inherit' });
  chmodSync(destBin, 0o755);
  rmSync(staging, { recursive: true, force: true });

  const canExec = resolvedTriple.includes(process.arch === 'arm64' ? 'aarch64' : 'x86_64');
  if (canExec) {
    const ver = execFileSync(destBin, ['-v'], { encoding: 'utf8' }).trim();
    if (!ver.startsWith(`v${NODE_MAJOR}.`)) {
      throw new Error(`expected Node ${NODE_MAJOR}.x, got ${ver}`);
    }
    console.log(`vendored ${ver} → ${destBin}`);
    return { version: ver, path: destBin, skipped: false, triple: resolvedTriple };
  }

  console.log(`vendored ${version} → ${destBin}`);
  return { version, path: destBin, skipped: false, triple: resolvedTriple };
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const force = process.argv.includes('--force');
  const tripleIdx = process.argv.indexOf('--triple');
  const triple = tripleIdx >= 0 ? process.argv[tripleIdx + 1] : undefined;
  vendorNode({ force, triple }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
