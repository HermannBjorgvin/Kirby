#!/usr/bin/env node
/**
 * What is in the renderer's entry chunk, and therefore what the window
 * has to parse and evaluate before it can paint anything.
 *
 *   node apps/desktop/scripts/analyze-bundle.mjs
 *   node apps/desktop/scripts/analyze-bundle.mjs --all   # every chunk
 *
 * Runs the real production build with one extra plugin that reports
 * each module's rendered size, then groups those by npm package and by
 * source folder. Sizes are pre-minification bytes, so they are a good
 * proxy for parse and evaluate cost and a poor one for download size —
 * which is the right way round here, since the app loads from disk.
 *
 * Nothing is written into the app's real dist; the build goes to a
 * scratch directory.
 */
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';

const CONFIG = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const OUT = fileURLToPath(new URL('../dist/bundle-analysis', import.meta.url));
const showAll = process.argv.includes('--all');

/** npm package, or the source folder two levels deep. */
function bucket(id) {
  const dep = /node_modules\/(@[^/]+\/[^/]+|[^/]+)/.exec(id);
  if (dep) return `npm:${dep[1]}`;
  const src = /(?:apps\/desktop\/src\/renderer|libs\/[^/]+\/src)\/(.*)/.exec(
    id
  );
  if (src) return `src:${src[1].split('/').slice(0, 2).join('/')}`;
  return `other:${id.slice(-50)}`;
}

const kb = (n) => `${(n / 1024).toFixed(1).padStart(9)} kB`;

const rows = [];
await build({
  configFile: CONFIG,
  logLevel: 'warn',
  build: { outDir: OUT, emptyOutDir: true },
  plugins: [
    {
      name: 'kirby-analyze',
      generateBundle(_opts, bundle) {
        for (const [file, chunk] of Object.entries(bundle)) {
          if (chunk.type !== 'chunk') continue;
          for (const [id, mod] of Object.entries(chunk.modules ?? {})) {
            rows.push({ file, id, bytes: mod.renderedLength });
          }
        }
      },
    },
  ],
});
await rm(OUT, { recursive: true, force: true });

const byChunk = new Map();
for (const r of rows) byChunk.set(r.file, (byChunk.get(r.file) ?? 0) + r.bytes);

const chunks = [...byChunk.entries()].sort((a, b) => b[1] - a[1]);
console.log('=== chunks ===');
for (const [file, bytes] of showAll ? chunks : chunks.slice(0, 12)) {
  console.log(`${kb(bytes)}  ${file}`);
}

// The entry chunk is the one the page loads directly, and the only one
// that is unconditionally on the startup path.
const entry = chunks.find(([f]) => /index-[^/]*\.js$/.test(f))?.[0];
if (!entry) {
  console.error('\nNo entry chunk found — did the build layout change?');
  process.exit(1);
}

const groups = new Map();
for (const r of rows) {
  if (r.file !== entry) continue;
  const k = bucket(r.id);
  groups.set(k, (groups.get(k) ?? 0) + r.bytes);
}
const total = [...groups.values()].reduce((a, b) => a + b, 0);
console.log(`\n=== what boots: ${entry} (${kb(total).trim()}) ===`);
for (const [name, bytes] of [...groups.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, showAll ? 200 : 30)) {
  console.log(`${kb(bytes)}  ${name}`);
}
