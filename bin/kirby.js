#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const entry = join(root, 'apps/cli/src/main.tsx');
const tsconfig = join(root, 'apps/cli/tsconfig.app.json');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

const child = spawn(tsx, [entry, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: { ...process.env, TSX_TSCONFIG_PATH: tsconfig },
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
