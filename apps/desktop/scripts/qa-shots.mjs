#!/usr/bin/env node
/**
 * Headless visual QA: launches the built desktop app under xvfb (if
 * available), drives it through a few screens, and writes PNGs.
 *
 *   node apps/desktop/scripts/qa-shots.mjs <repoPath> <outDir>
 *
 * Requires `nx build desktop` first. Uses the KIRBY_QA_STEPS hook in
 * src/main/main.ts.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , repoArg, outArg] = process.argv;
if (!repoArg || !outArg) {
  console.error('usage: qa-shots.mjs <repoPath> <outDir>');
  process.exit(2);
}
const repo = resolve(repoArg);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const electron = join(root, 'node_modules', '.bin', 'electron');
const appDir = join(root, 'apps', 'desktop');

const key = (k, o = {}) =>
  `window.dispatchEvent(new KeyboardEvent("keydown",Object.assign({key:${JSON.stringify(
    k
  )},bubbles:true},${JSON.stringify(o)})))`;
const dblclickRow = (pred) =>
  `(()=>{const rows=[...document.querySelectorAll("aside [role=button]")];const r=rows.find(${pred});if(r){r.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));}})()`;

const steps = [
  { waitMs: 6000, shot: join(out, '01-workspace.png') },
  {
    js: dblclickRow('()=>true'),
    waitMs: 2500,
    shot: join(out, '02-first-item.png'),
  },
  {
    js: dblclickRow('x=>/#\\d+/.test(x.textContent)'),
    waitMs: 7000,
    shot: join(out, '03-pr-review.png'),
  },
  {
    js: key('k', { ctrlKey: true }),
    waitMs: 1200,
    shot: join(out, '04-palette.png'),
  },
  { js: key('Escape'), waitMs: 300 },
  {
    js: key(',', { ctrlKey: true }),
    waitMs: 1500,
    shot: join(out, '05-settings.png'),
  },
  {
    js: `document.documentElement.classList.remove("dark");document.documentElement.style.colorScheme="light"`,
    waitMs: 800,
    shot: join(out, '06-settings-light.png'),
  },
  {
    js: `(()=>{const t=[...document.querySelectorAll("[role=tab]")][1];t&&t.click()})()`,
    waitMs: 1500,
    shot: join(out, '07-light-pr.png'),
  },
];

const useXvfb = spawnSync('which', ['xvfb-run']).status === 0;
const cmd = useXvfb ? 'xvfb-run' : electron;
const args = useXvfb
  ? [
      '-a',
      '-s',
      '-screen 0 1440x900x24',
      electron,
      '--no-sandbox',
      '--disable-gpu',
      appDir,
    ]
  : ['--no-sandbox', '--disable-gpu', appDir];

// This runs against the developer's real HOME and a real repo, so the
// one thing it must not share is their tmux server: with the backend
// defaulting to tmux, opening the repo reattaches every persisted agent
// — adopting them into a throwaway screenshot run and reflowing their
// panes to its window size. `$TMUX` beats TMUX_TMPDIR, so it is removed
// rather than overridden, and the socket points at an empty scratch dir.
const qaEnv = {
  ...process.env,
  TMUX_TMPDIR: mkdtempSync(join(tmpdir(), 'kirby-qa-tmux-')),
};
delete qaEnv.TMUX;
delete qaEnv.TMUX_PANE;

const res = spawnSync(cmd, args, {
  stdio: 'inherit',
  timeout: 150_000,
  env: {
    ...qaEnv,
    KIRBY_START_DIR: repo,
    KIRBY_DESKTOP_VERSION: 'qa',
    // A caller may pre-set KIRBY_QA_STEPS to drive a custom scenario.
    KIRBY_QA_STEPS: process.env.KIRBY_QA_STEPS ?? JSON.stringify(steps),
  },
});
if (!process.env.KIRBY_QA_STEPS && !existsSync(join(out, '01-workspace.png'))) {
  console.error('[qa-shots] no screenshots were produced');
  process.exit(res.status ?? 1);
}
console.log(`[qa-shots] wrote screenshots to ${out}`);
