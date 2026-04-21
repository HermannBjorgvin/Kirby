import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, 'dist', 'public');
const workspaceRoot = path.resolve(__dirname, '..', '..');

await mkdir(dist, { recursive: true });

await Promise.all([
  build({
    entryPoints: [path.resolve(__dirname, 'src/public/client.ts')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    outfile: path.resolve(dist, 'client.js'),
    sourcemap: true,
    logLevel: 'info',
  }),
  copyFile(
    path.resolve(__dirname, 'src/public/index.html'),
    path.resolve(dist, 'index.html')
  ),
  copyFile(
    path.resolve(workspaceRoot, 'node_modules/@wterm/dom/src/terminal.css'),
    path.resolve(dist, 'terminal.css')
  ),
]);
