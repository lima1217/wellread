#!/usr/bin/env node
/**
 * Static checks for wellread acceptance DoD (10 §2) — repo shape only.
 * Runtime/sidecar handshake and BYO chat still need a manual/app launch pass.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const app = join(root, 'apps/readest-app');
let failed = 0;

function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failed += 1;
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function existsUnder(dir) {
  try {
    return existsSync(dir) && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

check(
  '2.1 no gen/android',
  !existsUnder(join(app, 'src-tauri/gen/android')),
);
check(
  '2.1 no gen/apple',
  !existsUnder(join(app, 'src-tauri/gen/apple')),
);
check(
  '2.1 no .github/workflows',
  !existsUnder(join(root, '.github/workflows')),
);

const tauriConf = JSON.parse(
  readFileSync(join(app, 'src-tauri/tauri.conf.json'), 'utf8'),
);
check(
  '2.1 eve .output resources registered',
  Boolean(tauriConf.bundle?.resources?.['../../eve-sidecar/.output']),
);
check(
  '2.1 externalBin includes binaries/node',
  Array.isArray(tauriConf.bundle?.externalBin) &&
    tauriConf.bundle.externalBin.includes('binaries/node'),
);

const nodeBin = join(app, 'src-tauri/binaries/node-aarch64-apple-darwin');
if (existsSync(nodeBin)) {
  check('2.1 vendored node binary present', true, nodeBin);
} else {
  check(
    '2.1 vendored node binary present',
    false,
    'run: pnpm --dir apps/eve-sidecar vendor-node',
  );
}

check('2.2 no services/ai', !existsSync(join(app, 'src/services/ai')));
check('2.2 no services/reedy', !existsSync(join(app, 'src/services/reedy')));
check('2.2 no AuthContext', !existsSync(join(app, 'src/context/AuthContext.tsx')));
check('2.2 no libs/payment', !existsSync(join(app, 'src/libs/payment')));
check(
  '2.2 no services/translators',
  !existsSync(join(app, 'src/services/translators')),
);
check(
  '2.2 no discord_rpc.rs',
  !existsSync(join(app, 'src-tauri/src/discord_rpc.rs')),
);
check(
  '2.2 no sentry_config.rs',
  !existsSync(join(app, 'src-tauri/src/sentry_config.rs')),
);

check(
  '2.3 wellread assistant present',
  existsSync(join(app, 'src/services/wellread/assistant')),
);
check(
  '2.3 eve_sidecar.rs present',
  existsSync(join(app, 'src-tauri/src/eve_sidecar.rs')),
);
check(
  '2.4 books scoped-fs present',
  existsSync(join(root, 'apps/eve-sidecar/src/books/scopedFs.mjs')),
);
check(
  '2.5 modelConfig module present',
  existsSync(join(app, 'src/services/wellread/modelConfig.ts')),
);

const outputEntry = join(root, 'apps/eve-sidecar/.output/server/index.mjs');
check(
  'sidecar .output built',
  existsSync(outputEntry),
  existsSync(outputEntry) ? '' : 'run: pnpm --dir apps/eve-sidecar build',
);

if (existsSync(outputEntry)) {
  const raw = readFileSync(outputEntry, 'utf8');
  check('sidecar entry has no ../../src imports', !raw.includes('../../src/'));
  const nm = join(root, 'apps/eve-sidecar/.output/node_modules');
  check('sidecar .output/node_modules present', existsSync(nm) && statSync(nm).isDirectory());
}

console.log(failed === 0 ? '\nDoD static checks passed.' : `\n${failed} DoD static check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
