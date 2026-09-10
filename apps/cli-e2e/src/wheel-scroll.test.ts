import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/kirby.js';
import type { KirbyTerm } from './fixtures/kirby.js';
import { registerCleanup } from './setup/git-repo.js';
import { sidebarLocator } from './setup/sidebar.js';
import { TEST_REPO, wtermHost } from './setup/constants.js';

// Mouse-wheel scrolling in the diff viewer. The browser terminal has
// no mouse reporting, so raw SGR wheel sequences are injected into
// stdin via term.write() — exactly the bytes a real terminal sends —
// and asserted through the resulting viewport state plus the DECSET
// mouse-mode bytes Kirby emits (read back via GET /output).

const hasGhToken = !!process.env.GH_TOKEN;

// Pointer at column 80 — inside the main pane. The sidebar owns
// columns 1-48 and scrolls its own selection.
const WHEEL_DOWN = '\x1b[<65;80;12M';
const WHEEL_UP = '\x1b[<64;80;12M';
const SIDEBAR_WHEEL_DOWN = '\x1b[<65;10;12M';

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-wheel-clone-'));
registerCleanup(cloneDir);

if (hasGhToken) {
  const token = process.env.GH_TOKEN;
  execSync(`gh repo clone "${TEST_REPO}" "${cloneDir}"`, { stdio: 'pipe' });
  execSync(
    `git remote set-url origin "https://x-access-token:${token}@github.com/${TEST_REPO}.git"`,
    { cwd: cloneDir, stdio: 'pipe' }
  );
  execSync('git config user.email "e2e@kirby.dev"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Kirby E2E"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git fetch origin fixture/add-color-support', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
}

async function rawOutput(baseURL: string | undefined): Promise<string> {
  const res = await fetch(`${wtermHost(baseURL)}/output`);
  const { base64 } = (await res.json()) as { base64: string };
  return Buffer.from(base64, 'base64').toString('latin1');
}

test.describe('@integration Wheel scrolling', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    kirbyRepoPath: cloneDir,
    kirbyConfig: { keybindPreset: 'vim' },
    rows: 40,
    cols: 120,
  });

  async function openColorSupportDiff(kirby: { term: KirbyTerm }) {
    await expect(
      kirby.term.getByText('Add color support for tile values').first()
    ).toBeVisible({ timeout: 30_000 });
    const pr37 = sidebarLocator(kirby.term.page, 'Add color support');
    while ((await pr37.selected().count()) === 0) {
      await kirby.term.press('j');
    }
    await kirby.term.press('d');
    await kirby.term.page
      .locator('.term-row', { hasText: /\.(c|h)\b/ })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
  }

  test('wheel events scroll the diff viewer', async ({ kirby, baseURL }) => {
    await openColorSupportDiff(kirby);
    await kirby.term.press('Enter');
    await expect(
      kirby.term.page.locator('.term-row', { hasText: /@@.*@@/ }).first()
    ).toBeVisible({ timeout: 30_000 });

    // Kirby enables SGR button-event mouse tracking for the viewer.
    expect(await rawOutput(baseURL)).toContain('\x1b[?1000h\x1b[?1006h');
    await expect(kirby.term.getByText('rows above')).toBeHidden();

    // A batched chunk of wheel-down events must all be consumed (the
    // pre-2026 parser took one event per chunk).
    await kirby.term.write(WHEEL_DOWN + WHEEL_DOWN + WHEEL_DOWN);
    await expect(kirby.term.getByText('rows above').first()).toBeVisible({
      timeout: 10_000,
    });

    for (let i = 0; i < 5; i++) await kirby.term.write(WHEEL_UP);
    await expect(kirby.term.getByText('rows above')).toBeHidden({
      timeout: 10_000,
    });

    // A wheel event over the sidebar region must NOT scroll the diff.
    await kirby.term.write(SIDEBAR_WHEEL_DOWN);
    await expect(kirby.term.getByText('rows above')).toBeHidden();
  });

  test('mouse clicks do not leak into compose input', async ({ kirby }) => {
    await openColorSupportDiff(kirby);
    // A stray click while the diff list is focused must not act as
    // input — the SGR bytes previously reached Ink as garbage
    // keypresses.
    await kirby.term.write('\x1b[<0;10;5M\x1b[<0;10;5m');
    await expect(
      kirby.term.page.locator('.term-row', { hasText: /\.(c|h)\b/ }).first()
    ).toBeVisible();
  });
});
