/**
 * Vendor Node 24.x (darwin-arm64) into Tauri externalBin path.
 *
 * Destination: apps/readest-app/src-tauri/binaries/node-aarch64-apple-darwin
 * Spec: 10 §1.2 / 05 §2.1 — Node 24.x official binary, Tauri triple naming.
 */
import { createWriteStream, chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

const NODE_MAJOR = 24;
const TRIPLE = 'aarch64-apple-darwin';
const PLATFORM = 'darwin-arm64';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');
const destDir = join(repoRoot, 'apps/readest-app/src-tauri/binaries');
const destBin = join(destDir, `node-${TRIPLE}`);

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

export async function vendorNode({ force = false } = {}) {
  mkdirSync(destDir, { recursive: true });
  if (!force && existsSync(destBin)) {
    try {
      const ver = execFileSync(destBin, ['-v'], { encoding: 'utf8' }).trim();
      if (ver.startsWith(`v${NODE_MAJOR}.`)) {
        console.log(`vendored node already present (${ver}) → ${destBin}`);
        return { version: ver, path: destBin, skipped: true };
      }
    } catch {
      // fall through to re-download
    }
  }
  const version = await latestNode24Version();
  const tarball = `node-${version}-${PLATFORM}.tar.gz`;
  const url = `https://nodejs.org/dist/${version}/${tarball}`;
  const staging = mkdtempSync(join(tmpdir(), 'wellread-node-'));
  const tarballPath = join(staging, tarball);

  console.log(`vendoring ${url}`);
  await download(url, tarballPath);
  execFileSync('tar', ['-xzf', tarballPath, '-C', staging], { stdio: 'inherit' });
  const extracted = join(staging, `node-${version}-${PLATFORM}`, 'bin', 'node');
  if (!existsSync(extracted)) {
    throw new Error(`extracted node missing at ${extracted}`);
  }
  rmSync(destBin, { force: true });
  execFileSync('cp', [extracted, destBin], { stdio: 'inherit' });
  chmodSync(destBin, 0o755);
  rmSync(staging, { recursive: true, force: true });

  const ver = execFileSync(destBin, ['-v'], { encoding: 'utf8' }).trim();
  if (!ver.startsWith(`v${NODE_MAJOR}.`)) {
    throw new Error(`expected Node ${NODE_MAJOR}.x, got ${ver}`);
  }
  console.log(`vendored ${ver} → ${destBin}`);
  return { version: ver, path: destBin, skipped: false };
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const force = process.argv.includes('--force');
  vendorNode({ force }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
