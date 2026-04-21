import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, 'dist');
const publicDist = path.resolve(dist, 'public');
const workspaceRoot = path.resolve(__dirname, '..', '..');

await rm(dist, { recursive: true, force: true });
await mkdir(publicDist, { recursive: true });

await Promise.all([
  build({
    entryPoints: [path.resolve(__dirname, 'src/main.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: path.resolve(dist, 'main.js'),
    external: ['node-pty', 'ws'],
    sourcemap: true,
    banner: {
      js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
    },
  }),
  build({
    entryPoints: [path.resolve(__dirname, 'src/public/client.ts')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    outfile: path.resolve(publicDist, 'client.js'),
    sourcemap: true,
  }),
  copyFile(
    path.resolve(__dirname, 'src/public/index.html'),
    path.resolve(publicDist, 'index.html')
  ),
  copyFile(
    path.resolve(workspaceRoot, 'node_modules/@wterm/dom/src/terminal.css'),
    path.resolve(publicDist, 'terminal.css')
  ),
]);
