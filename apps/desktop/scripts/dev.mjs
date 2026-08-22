/**
 * Dev orchestrator for kirby-desktop:
 *   1. builds main + preload bundles with esbuild (watched)
 *   2. starts the Vite dev server for the renderer (HMR)
 *   3. launches Electron pointed at the dev server
 *   4. restarts Electron whenever a host-side bundle rebuilds;
 *      renderer changes hot-reload without a restart
 *
 * Run via `nx serve desktop`.
 */
import { build, context } from 'esbuild';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);
const appRoot = join(workspaceRoot, 'apps', 'desktop');
const electronBin = join(workspaceRoot, 'node_modules', '.bin', 'electron');
const DEV_URL = 'http://localhost:5173';

// Must mirror the build-main nx target exactly: electron + node-pty
// stay external, and the ESM output needs a require shim for them.
const REQUIRE_BANNER =
  'import { createRequire as __kirbyCreateRequire } from "node:module";' +
  'const require = __kirbyCreateRequire(import.meta.url);';

const mainOptions = {
  entryPoints: [join(appRoot, 'src/main/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['electron', 'node-pty'],
  banner: { js: REQUIRE_BANNER },
  outfile: join(appRoot, 'dist/main/main.js'),
};

const preloadOptions = {
  entryPoints: [join(appRoot, 'src/preload/preload.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  outfile: join(appRoot, 'dist/preload/preload.cjs'),
};

let electronProcess = null;

// npm-installed Electron often can't use its SUID sandbox (chrome-sandbox
// not root-owned 4755) — e.g. inside containers or unusual setups.
// Detect that and fall back to --no-sandbox rather than crashing.
function electronArgs() {
  const args = [];
  try {
    const st = statSync(
      join(workspaceRoot, 'node_modules', 'electron', 'dist', 'chrome-sandbox')
    );
    if (!(st.uid === 0 && (st.mode & 0o4755) === 0o4755)) {
      console.warn(
        '[desktop] SUID sandbox unavailable — launching with --no-sandbox (dev only)'
      );
      args.push('--no-sandbox');
    }
  } catch {
    args.push('--no-sandbox');
  }
  return args;
}

function startElectron() {
  if (electronProcess) electronProcess.kill();
  electronProcess = spawn(electronBin, [...electronArgs(), '.'], {
    cwd: appRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      KIRBY_VITE_URL: DEV_URL,
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });
}

// Initial full build so Electron has something to load.
await build(mainOptions);
await build(preloadOptions);

const vite = await createServer({
  root: join(appRoot, 'src/renderer'),
  clearScreen: false,
  server: { port: 5173, strictPort: true },
});
await vite.listen();
console.log('[desktop] vite dev server on ' + DEV_URL);

let restarting = false;
const contexts = [];
async function watch(options) {
  const ctx = await context(options);
  contexts.push(ctx);
  await ctx.watch(() => {
    if (restarting) return;
    restarting = true;
    console.log('[desktop] host bundle changed — restarting electron…');
    // Small delay so the write completes before the new process reads it.
    setTimeout(() => {
      startElectron();
      restarting = false;
    }, 200);
  });
}
await watch(mainOptions);
await watch(preloadOptions);

startElectron();

process.on('SIGINT', () => {
  electronProcess?.kill();
  void vite.close();
  for (const ctx of contexts) void ctx.dispose();
  process.exit(0);
});
