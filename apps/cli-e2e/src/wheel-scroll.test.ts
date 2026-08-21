import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/kirby.js';
import { registerCleanup } from './setup/git-repo.js';
import { sidebarLocator } from './setup/sidebar.js';
import { TEST_REPO } from './setup/constants.js';

// Mouse-wheel scrolling in the diff viewer. wterm has no mouse
// reporting (browser wheel events scroll the DOM, nothing reaches the
// PTY), so these tests inject raw SGR wheel sequences into stdin via
// term.write() — exactly the bytes a real terminal would send — and
// assert on the resulting viewport state plus the DECSET mouse-mode
// bytes Kirby emits (read back through the host's GET /output).

const hasGhToken = !!process.env.GH_TOKEN;
const HOST = process.env.BASE_URL ?? 'http://localhost:5174';

const WHEEL_DOWN = '\x1b[<65;40;12M';
const WHEEL_UP = '\x1b[<64;40;12M';

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

async function rawOutput(): Promise<string> {
  const res = await fetch(`${HOST}/output`);
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

  test('wheel events scroll the diff viewer', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
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
    await kirby.term.press('Enter');
    await expect(
      kirby.term.page.locator('.term-row', { hasText: /@@.*@@/ }).first()
    ).toBeVisible({ timeout: 30_000 });

    // Kirby enables SGR button-event mouse tracking for the viewer.
    expect(await rawOutput()).toContain('\x1b[?1000h\x1b[?1006h');

    // At the top there is no "rows above" indicator.
    await expect(kirby.term.getByText('rows above')).not.toBeVisible();

    // A batched chunk of wheel-down events must all be consumed
    // (regression: the old parser took one event per chunk).
    await kirby.term.write(WHEEL_DOWN + WHEEL_DOWN + WHEEL_DOWN);
    await expect(kirby.term.getByText('rows above').first()).toBeVisible({
      timeout: 10_000,
    });

    // Wheel back up returns to the top.
    for (let i = 0; i < 5; i++) await kirby.term.write(WHEEL_UP);
    await expect(kirby.term.getByText('rows above')).not.toBeVisible({
      timeout: 10_000,
    });
  });

  test('mouse clicks do not leak into compose input', async ({ kirby }) => {
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

    // A stray click while the diff list is focused must not act as
    // input anywhere (previously the SGR bytes reached Ink as garbage
    // keypresses).
    await kirby.term.write('\x1b[<0;10;5M\x1b[<0;10;5m');
    // The list is still on screen and did not navigate away.
    await expect(
      kirby.term.page.locator('.term-row', { hasText: /\.(c|h)\b/ }).first()
    ).toBeVisible();
  });
});
