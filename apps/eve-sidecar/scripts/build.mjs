import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.output', 'server');
mkdirSync(outDir, { recursive: true });
cpSync(join(root, 'src', 'createModel.mjs'), join(outDir, 'createModel.mjs'));
console.log('eve-sidecar build ok:', outDir);
