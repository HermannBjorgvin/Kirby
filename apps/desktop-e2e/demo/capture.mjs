#!/usr/bin/env node
/**
 * Records the README media: launches the built desktop app on a
 * dedicated Xvfb display at 2x device scale, drives it like a user
 * (gliding cursor, real typing), records with ffmpeg (x11grab) and
 * downscales to palette-optimized GIFs. Stills come from Playwright
 * screenshots at the same 2x scale.
 *
 *   node apps/desktop-e2e/demo/capture.mjs [hero|worktrees|review|plan|all]
 *
 * Requires `nx build desktop` first, plus Xvfb and ffmpeg on PATH.
 * Output lands in docs/media/.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { buildScenario } from './scenario.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const APP_DIR = join(ROOT, 'apps', 'desktop');
const MEDIA = join(ROOT, 'docs', 'media');
const RAW = join(MEDIA, 'raw');

const DISPLAY = ':91';
// Logical 1280x800 at 2x — crisp text once the GIF downscales.
const DIP = { width: 1280, height: 800 };
const PX = { width: DIP.width * 2, height: DIP.height * 2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The page of the app being driven right now, for failure stills. */
let currentPage = null;
/** The active recording, so a failed demo still stops its ffmpeg. */
let currentRec = null;

// ── Display + recording ──────────────────────────────────────────

function startXvfb() {
  const xvfb = spawn('Xvfb', [
    DISPLAY,
    '-screen',
    '0',
    `${PX.width}x${PX.height}x24`,
    '-nolisten',
    'tcp',
  ]);
  return xvfb;
}

function startRecording(name) {
  const out = join(RAW, `${name}.mkv`);
  const ff = spawn('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'x11grab',
    '-framerate',
    '30',
    '-video_size',
    `${PX.width}x${PX.height}`,
    '-draw_mouse',
    '0',
    '-i',
    DISPLAY,
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    '-crf',
    '17',
    out,
  ]);
  const rec = {
    file: out,
    stop: () =>
      new Promise((resolveStop) => {
        if (currentRec === rec) currentRec = null;
        ff.on('exit', resolveStop);
        ff.kill('SIGINT');
      }),
  };
  currentRec = rec;
  return rec;
}

function toGif(name, { width = 960, fps = 12, start = 0, end } = {}) {
  const src = join(RAW, `${name}.mkv`);
  const gif = join(MEDIA, `${name}.gif`);
  const trim = [
    ...(start ? ['-ss', String(start)] : []),
    ...(end ? ['-to', String(end)] : []),
  ];
  const filters = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  const res = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', ...trim, '-i', src, '-vf', filters, gif],
    { stdio: 'inherit' }
  );
  if (res.status !== 0) throw new Error(`ffmpeg gif failed for ${name}`);
  return gif;
}

// ── App ──────────────────────────────────────────────────────────

async function launchApp(scenario, { theme = 'dark' } = {}) {
  const parentEnv = { ...process.env };
  delete parentEnv.WAYLAND_DISPLAY;
  delete parentEnv.EDITOR;
  delete parentEnv.VISUAL;
  // Theme is a desktop pref, not config — write it before launch.
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    join(scenario.home, '.kirby', 'desktop-prefs.json'),
    JSON.stringify({ theme, nativeFrame: false })
  );

  const app = await electron.launch({
    args: [
      APP_DIR,
      '--no-sandbox',
      '--disable-gpu',
      '--ozone-platform=x11',
      '--force-device-scale-factor=2',
    ],
    cwd: ROOT,
    env: {
      ...parentEnv,
      DISPLAY,
      HOME: scenario.home,
      XDG_CONFIG_HOME: join(scenario.home, '.config'),
      KIRBY_START_DIR: scenario.repo,
      KIRBY_DESKTOP_VERSION: '1.0.0',
      TMUX_TMPDIR: scenario.home,
      ...scenario.env,
    },
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  currentPage = page;
  await app.evaluate(({ BrowserWindow }, dip) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.setBounds({ x: 0, y: 0, width: dip.width, height: dip.height });
    win.webContents.setBackgroundThrottling(false);
    win.show();
    win.focus();
  }, DIP);
  await page.waitForLoadState('domcontentloaded');
  await page
    .getByRole('button', { name: 'New worktree', exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  return { app, page };
}

/** A visible cursor that follows the (real) pointer, with a click pulse. */
async function installCursor(page) {
  await page.evaluate(() => {
    const dot = document.createElement('div');
    dot.id = 'demo-cursor';
    Object.assign(dot.style, {
      position: 'fixed',
      width: '18px',
      height: '18px',
      borderRadius: '50%',
      background: 'rgba(30,30,30,0.45)',
      border: '2px solid rgba(255,255,255,0.9)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
      pointerEvents: 'none',
      zIndex: '2147483647',
      left: '-40px',
      top: '-40px',
      transform: 'translate(-50%, -50%)',
    });
    document.body.appendChild(dot);
    window.addEventListener(
      'mousemove',
      (e) => {
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
      },
      true
    );
    window.addEventListener(
      'mousedown',
      () => {
        dot.animate(
          [
            { transform: 'translate(-50%,-50%) scale(1)' },
            { transform: 'translate(-50%,-50%) scale(0.7)' },
            { transform: 'translate(-50%,-50%) scale(1)' },
          ],
          { duration: 220 }
        );
      },
      true
    );
  });
}

/** Glide the mouse to a locator like a hand would, then settle. */
async function glide(page, locator, { dwell = 350 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('glide target not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 28,
  });
  await sleep(dwell);
  return locator;
}

async function click(page, locator, opts) {
  await glide(page, locator, opts);
  await locator.click();
}

/**
 * Move the pointer somewhere harmless. Sonner pauses a toast's dismiss
 * timer while the pointer is over it, and the toasts stack in the
 * bottom-right — exactly where the primary buttons are — so a take that
 * ends on a click keeps its toast on screen forever.
 */
async function park(page) {
  await page.mouse.move(DIP.width * 0.55, DIP.height * 0.45, { steps: 20 });
}

// ── The terminal UI ──────────────────────────────────────────────
//
// The TUI is an Ink app in a PTY, so there is no window to record. It
// is driven through the same bridge the cli-e2e suite uses: the wterm
// host spawns Kirby on a PTY and streams it to a browser page that is
// nothing but a full-bleed terminal. Chromium runs in app mode (no
// tabs, no toolbar, no scrollbars), so the recording is the terminal
// and nothing else.

const TUI_PORT = 5178;
const TUI_ORIGIN = `http://localhost:${TUI_PORT}`;

/** Environment for a browser that must render on our Xvfb display. */
function browserEnv() {
  const env = { ...process.env, DISPLAY };
  delete env.WAYLAND_DISPLAY;
  return env;
}

async function startWtermHost() {
  const host = spawn(
    'node',
    [join(ROOT, 'apps', 'cli-wterm-host', 'dist', 'main.js')],
    { cwd: ROOT, env: { ...process.env, PORT: String(TUI_PORT) } }
  );
  host.stdout?.on('data', () => undefined);
  host.stderr?.on('data', (d) => process.stderr.write(`[wterm] ${d}`));
  // Wait for the port rather than a fixed sleep.
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(TUI_ORIGIN, { method: 'HEAD' });
      return host;
    } catch {
      await sleep(100);
    }
  }
  host.kill('SIGTERM');
  throw new Error('wterm host did not come up');
}

/**
 * Spawn Kirby on the host's PTY, then open it in a chrome-less browser
 * sized to the terminal grid.
 */
async function launchTui(scenario, { cols = 132, rows = 34 } = {}) {
  const res = await fetch(`${TUI_ORIGIN}/spawn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repoPath: scenario.repo,
      homeDir: scenario.home,
      cols,
      rows,
      env: { ...scenario.env, TMUX_TMPDIR: scenario.home },
    }),
  });
  if (!res.ok) throw new Error(`/spawn failed: ${res.status}`);

  // A persistent context, because that is the only launch Playwright
  // attaches to an `--app` window: `chromium.launch` opens its own
  // about:blank and reports zero contexts for the app one.
  const ctx = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), 'kirby-demo-chrome-')),
    {
      headless: false,
      // Same trap as the Electron fixture: Chromium talks to the
      // compositor through WAYLAND_DISPLAY and ignores the X display
      // Xvfb hands it, so the window opens on the developer's real
      // desktop and the recording is a black screen. Drop the variable
      // and pin ozone to x11.
      env: browserEnv(),
      viewport: null,
      args: [
        `--app=${TUI_ORIGIN}`,
        '--ozone-platform=x11',
        `--window-size=${DIP.width},${DIP.height}`,
        '--window-position=0,0',
        '--force-device-scale-factor=2',
        '--hide-scrollbars',
        '--no-first-run',
        '--disable-infobars',
      ],
    }
  );
  const page = ctx.pages()[0];
  if (!page) throw new Error('the app window never opened');
  currentPage = page;
  await page.waitForLoadState('domcontentloaded');
  // Kirby has painted its first frame once its own name is on screen.
  await page
    .getByText('Kirby')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  return { browser: ctx, page };
}

/** The TUI takes keys, not clicks — type at a human pace. */
async function keys(page, seq, { delay = 260 } = {}) {
  for (const k of seq) {
    await page.keyboard.press(k);
    await sleep(delay);
  }
}

async function demoTui(scenario) {
  const host = await startWtermHost();
  let browser;
  try {
    ({ browser } = await launchTui(scenario));
    const page = currentPage;
    await sleep(1200);
    const rec = startRecording('tui');
    await sleep(1200);

    // Down the sidebar and back up: a worktree, then the pull
    // requests with their CI and review state, then the review queue.
    // The rows carry the same two axes the desktop's circles do, spelled
    // out in the legend at the bottom left.
    await keys(page, ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown'], {
      delay: 850,
    });
    await sleep(1000);
    // Back up to the pull request with review comments on it.
    await keys(page, ['ArrowUp', 'ArrowUp', 'ArrowUp'], { delay: 700 });
    await sleep(1300);

    // Its changed files, then the diff itself, with the reviewers'
    // threads inline against the code they are about.
    await page.keyboard.press('d');
    await sleep(2200);
    await page.keyboard.press('Enter');
    await sleep(2200);
    // On to the file the reviewers actually commented on — their
    // threads render inline, against the lines they are about.
    await page.keyboard.press('ArrowRight');
    await sleep(2200);
    await keys(page, ['j', 'j', 'j', 'j', 'j', 'j'], { delay: 420 });
    await sleep(3200);

    await rec.stop();
    toGif('tui');
  } finally {
    await browser?.close().catch(() => undefined);
    await fetch(`${TUI_ORIGIN}/kill`, { method: 'POST' }).catch(
      () => undefined
    );
    host.kill('SIGTERM');
  }
}

// ── Demos ────────────────────────────────────────────────────────

async function openPr(page, title) {
  await page.locator('aside').getByRole('button', { name: title }).click();
  await page
    .getByText('Review', { exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
}

const card = (page, text) =>
  page.locator('[data-thread]').filter({ hasText: text });

async function demoHero(scenario) {
  for (const theme of ['dark', 'light']) {
    const { app, page } = await launchApp(scenario, { theme });
    // An agent running in the background puts the workspace in its
    // natural state: green dot on the row, Agent entry in the rail.
    await page.evaluate(() =>
      window.kirby.launchAgent({
        branch: 'command-palette',
        intent: 'continue-or-blank',
      })
    );
    await openPr(page, /Add a command palette/);
    // Launching showed the agent terminal; the hero is the diff, so
    // bring it back through the rail's file tree.
    await page
      .getByRole('button', { name: /palette\.ts/ })
      .filter({ visible: true })
      .last()
      .click();
    await card(page, 'runs the whole command list')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    // Give the sync loop a beat so the status bar reads "synced".
    await page
      .getByText(/synced (just now|\d)/)
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => undefined);
    await sleep(2500);
    await page.screenshot({
      path: join(MEDIA, theme === 'dark' ? 'hero.png' : 'hero-light.png'),
    });
    await app.close();
  }
}

async function demoWorktrees(scenario) {
  const { app, page } = await launchApp(scenario);
  await installCursor(page);
  await sleep(600);
  const rec = startRecording('worktrees');
  await sleep(700);

  // Open on the sidebar's status column. Each pull request's circle
  // carries both axes — the build and the reviewers — and its tooltip
  // says which one is holding the row up.
  const failing = page
    .locator('aside')
    .getByRole('button', { name: /Retry transient/ });
  await glide(page, failing.locator('[data-slot="tooltip-trigger"]').first(), {
    dwell: 2600,
  });
  await park(page);
  await sleep(600);

  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('Branch name, pull request, or command…');
  await input.waitFor({ state: 'visible' });
  await sleep(900);
  await input.pressSequentially('dark-mode', { delay: 120 });
  const createRow = page.getByRole('option', {
    name: /Create branch\s*dark-mode/,
  });
  await createRow.waitFor({ state: 'visible' });
  await sleep(900);
  await click(page, createRow);

  const launch = page
    .getByRole('button', { name: /^Launch agent$/i })
    .filter({ visible: true })
    .first();
  await launch.waitFor({ state: 'visible', timeout: 30_000 });
  await sleep(1300);
  await click(page, launch, { dwell: 600 });
  await page
    .getByText('What should I work on?')
    .filter({ visible: true })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  await park(page);
  await sleep(2600);

  await rec.stop();
  await app.close();
  toGif('worktrees');
}

async function demoReview(scenario) {
  const { app, page } = await launchApp(scenario);
  await installCursor(page);
  await sleep(600);
  const rec = startRecording('review');
  await sleep(700);

  await click(
    page,
    page.locator('aside').getByRole('button', { name: /session restore/i })
  );
  const ready = page.getByRole('button', { name: /Review ready/ });
  await ready.waitFor({ state: 'visible', timeout: 30_000 });
  await sleep(900);
  await click(page, ready);

  // Walk the drafts in severity order.
  await page
    .getByText('parses `session.live` twice', { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => undefined);
  await sleep(2200);
  // Scoped to the content pane: the rail's "Post all N drafts" also
  // starts with "Post", and posting everything ends the walkthrough.
  const post = page
    .getByTestId('review-content')
    .getByRole('button', { name: /^Post/ })
    .first();
  await click(page, post, { dwell: 600 });
  await page
    .getByText('Comment posted')
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => undefined);
  await sleep(2400);
  await click(page, page.getByRole('button', { name: /Skip/ }).first());
  await park(page);
  await sleep(2600);

  await rec.stop();
  await app.close();
  toGif('review');
}

async function demoPlan(scenario) {
  const { app, page } = await launchApp(scenario);
  await installCursor(page);
  await openPr(page, /Add a command palette/);
  await card(page, 'runs the whole command list')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  await sleep(800);
  const rec = startRecording('plan');
  await sleep(700);

  // Queue the first comment with one click.
  const first = card(page, 'runs the whole command list');
  await glide(page, first.getByText('sofia-codes').first());
  await click(
    page,
    first.getByRole('button', { name: 'Add to plan', exact: true }),
    { dwell: 500 }
  );
  await sleep(900);

  // Queue the second with a note.
  const second = card(page, 'keeps the old query');
  await second.scrollIntoViewIfNeeded();
  await glide(page, second.getByText('marcusv').first());
  await click(
    page,
    second.getByRole('button', {
      name: 'Add to plan with a note',
      exact: true,
    }),
    { dwell: 500 }
  );
  const note = page.getByLabel('Your note to the agent');
  await note.waitFor({ state: 'visible' });
  await sleep(400);
  await note.pressSequentially('Clear the query on close, not on open.', {
    delay: 45,
  });
  await sleep(400);
  await click(page, page.getByRole('button', { name: 'Save note' }));
  await sleep(900);

  // Checkout.
  await click(page, page.getByRole('button', { name: /^Plan\b/ }));
  await sleep(1400);
  await click(page, page.getByRole('button', { name: /Prompt preview/ }));
  await sleep(2200);
  await click(
    page,
    page.getByRole('button', { name: 'Start agent with plan' })
  );
  await page
    .getByText('connected to workspace')
    .filter({ visible: true })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  await park(page);
  // Long enough to see the agent read the plan back and start work,
  // not so long that the loop outstays its welcome.
  await sleep(7000);

  await rec.stop();
  await app.close();
  toGif('plan');
}

// ── Main ─────────────────────────────────────────────────────────

const which = process.argv[2] ?? 'all';
mkdirSync(RAW, { recursive: true });

if (!existsSync(join(APP_DIR, 'dist', 'main', 'main.js'))) {
  console.error('Build the app first: npx nx build desktop');
  process.exit(1);
}

const xvfb = startXvfb();
await sleep(1200);

const demos = {
  hero: demoHero,
  worktrees: demoWorktrees,
  review: demoReview,
  plan: demoPlan,
  tui: demoTui,
};
const picked =
  which === 'all' ? Object.keys(demos) : which.split(',').filter(Boolean);

try {
  for (const name of picked) {
    if (!demos[name]) throw new Error(`unknown demo: ${name}`);
    console.log(`▶ ${name}`);
    const scenario = buildScenario();
    try {
      await demos[name](scenario);
    } catch (err) {
      // Leave a still of where it died next to the raw recordings.
      await currentPage
        ?.screenshot({ path: join(RAW, `${name}-failed.png`) })
        .catch(() => undefined);
      await currentRec?.stop();
      throw err;
    }
    rmSync(scenario.home, { recursive: true, force: true });
    console.log(`✓ ${name}`);
  }
} finally {
  xvfb.kill('SIGTERM');
}
console.log(`media written to ${MEDIA}`);
