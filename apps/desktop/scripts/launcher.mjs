#!/usr/bin/env node
// Global-install entry point for kirby-desktop (`bin` in the dist
// package.json). Spawns the Electron binary against this app
// directory. Mirrors dev.mjs's SUID-sandbox fallback: npm-installed
// Electron often can't use its setuid helper, and crashing with
// SIGTRAP is a terrible first-run experience.
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appDir = dirname(fileURLToPath(import.meta.url));
const electron = require('electron'); // string: path to the electron binary
const { version } = require(join(appDir, 'package.json'));

const args = [];
try {
  const st = statSync(
    join(appDir, 'node_modules', 'electron', 'dist', 'chrome-sandbox')
  );
  if (!(st.uid === 0 && (st.mode & 0o4755) === 0o4755)) {
    console.warn(
      '[kirby-desktop] SUID sandbox unavailable — launching with --no-sandbox'
    );
    args.push('--no-sandbox');
  }
} catch {
  args.push('--no-sandbox');
}

const child = spawn(electron, [...args, appDir], {
  stdio: 'inherit',
  // Launching from inside a repo auto-opens that repo.
  env: {
    ...process.env,
    KIRBY_START_DIR: process.cwd(),
    KIRBY_DESKTOP_VERSION: version,
  },
});
child.on('close', (code) => process.exit(code ?? 0));
