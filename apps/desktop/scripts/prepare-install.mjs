#!/usr/bin/env node
// Builds apps/desktop/dist into a minimal, globally installable
// package (consumed by the `install-global` target):
//   - copies the launcher (bin entry) to dist/
//   - writes a distilled package.json
//
// The installed app needs exactly two runtime deps: electron (the
// binary the launcher spawns) and node-pty (kept external by esbuild
// because it's native). Everything else is bundled.

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '..');
const distDir = resolve(appDir, 'dist');

copyFileSync(
  resolve(appDir, 'scripts', 'launcher.mjs'),
  resolve(distDir, 'launcher.mjs')
);

const src = JSON.parse(readFileSync(resolve(appDir, 'package.json'), 'utf8'));

const electronVersion = src.devDependencies?.electron;
const nodePtyVersion =
  src.dependencies?.['node-pty'] ?? src.devDependencies?.['node-pty'];
if (!electronVersion) {
  throw new Error('electron version not found in source package.json');
}

const out = {
  name: 'kirby-desktop',
  version: src.version,
  description: src.description,
  author: src.author,
  license: src.license,
  type: 'module',
  // Explicit file list — without it npm pack honors the repo's
  // .gitignore, which excludes everything we ship. Paths are relative
  // to the pack root (dist/ itself).
  files: ['main/', 'preload/', 'renderer/', 'launcher.mjs'],
  main: 'main/main.js',
  bin: {
    'kirby-desktop': 'launcher.mjs',
  },
  engines: src.engines,
  repository: src.repository,
  dependencies: {
    electron: electronVersion,
    ...(nodePtyVersion ? { 'node-pty': nodePtyVersion } : {}),
  },
};

writeFileSync(
  resolve(distDir, 'package.json'),
  JSON.stringify(out, null, 2) + '\n'
);
// Pack a tarball: `npm install -g <folder>` only symlinks the folder
// and skips installing dependencies; installing the tarball performs
// a real dependency install (electron + node-pty).
const tarball = execSync('npm pack', { cwd: distDir, encoding: 'utf8' })
  .trim()
  .split('\n')
  .pop();
console.log(`[desktop] dist prepared for global install: ${tarball}`);
