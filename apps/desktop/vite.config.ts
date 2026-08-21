import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Renderer-only config. The Electron main and preload bundles are
// built separately by @nx/esbuild (see package.json targets).
export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), tailwindcss()],
  base: './',
  clearScreen: false,
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
