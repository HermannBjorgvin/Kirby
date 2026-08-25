import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Renderer-only config. The Electron main and preload bundles are
// built separately by @nx/esbuild (see package.json targets).
//
// `root` is absolute on purpose: Vite resolves a relative root against
// process.cwd(), and this config is loaded both by `vite build` (cwd =
// apps/desktop) and by scripts/dev.mjs (cwd = workspace root).
const rendererRoot = fileURLToPath(new URL('./src/renderer', import.meta.url));
const outDir = fileURLToPath(new URL('./dist/renderer', import.meta.url));

export default defineConfig({
  root: rendererRoot,
  plugins: [react(), tailwindcss()],
  assetsInclude: ['**/*.wasm'],
  base: './',
  clearScreen: false,
  // The diff worker uses dynamic imports (shiki grammars) — the
  // default iife worker format can't code-split.
  worker: { format: 'es' },
  build: {
    outDir,
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
