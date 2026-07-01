#!/usr/bin/env node
// Rewrites apps/cli/dist/package.json into a minimal, publish-safe package.
// The build copies the source package.json into dist/ (via the build's
// `assets` config) for local use (e.g. `npm install -g ./apps/cli/dist`),
// but that file carries workspace `@kirby/*` deps that don't exist on the
// npm registry, plus dev deps and nx config bloat. This strips all of it.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPkgPath = resolve(__dirname, '../dist/package.json');
const src = JSON.parse(readFileSync(distPkgPath, 'utf8'));

// node-pty is the only runtime dep kept external by esbuild (native module).
// Everything else — ink, react, @kirby/*, @inkjs/ui, @mishieck/ink-titled-box
// — is bundled into dist/main.js.
const nodePtyVersion = src.dependencies?.['node-pty'];
if (!nodePtyVersion) {
  throw new Error('node-pty missing from source dependencies');
}

const out = {
  name: src.name,
  version: src.version,
  description: src.description,
  author: src.author,
  license: src.license,
  type: src.type,
  bin: src.bin,
  files: ['main.js'],
  publishConfig: src.publishConfig,
  engines: src.engines,
  repository: src.repository,
  dependencies: { 'node-pty': nodePtyVersion },
};

writeFileSync(distPkgPath, JSON.stringify(out, null, 2) + '\n');
console.log(`Prepared ${distPkgPath} for publish (name=${out.name}@${out.version})`);
