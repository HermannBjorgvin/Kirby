import { test, expect } from './fixtures/kirby.js';
import type { KirbyTerm } from './fixtures/kirby.js';
import { sidebarLocator } from './setup/sidebar.js';
import { settleFor } from './setup/waits.js';

// Wheel + click over the sidebar column. The browser terminal has no
// mouse reporting, so raw SGR sequences are injected via term.write()
// — see wheel-scroll.test.ts for the main-pane counterpart.

const SIDEBAR_WHEEL_DOWN = '\x1b[<65;10;5M';
const SIDEBAR_WHEEL_UP = '\x1b[<64;10;5M';

test.use({
  kirbyConfig: {
    aiCommand: 'echo kirby-session-active && sleep 300',
    keybindPreset: 'vim',
  },
});

async function createSession(kirby: { term: KirbyTerm }, branch: string) {
  await kirby.term.type('c');
  await expect(kirby.term.getByText('Branch Picker')).toBeVisible();
  await kirby.term.type(branch);
  await expect(kirby.term.getByText(/\(new branch\)/).first()).toBeVisible({
    timeout: 5_000,
  });
  // Let React re-render so useInput's closure captures the filter.
  await settleFor(
    kirby.term.page,
    2_000,
    "branch picker's useInput closure catches up to the typed filter"
  );
  await kirby.term.press('Enter');
  // Wait for the picker to fully close before the next `c` — a second
  // picker opened too early races the first one's teardown.
  await expect(kirby.term.getByText('Branch Picker')).toBeHidden({
    timeout: 5_000,
  });
  await expect(kirby.term.getByText(branch).first()).toBeVisible({
    timeout: 10_000,
  });
}

test.describe('Sidebar wheel scrolling', () => {
  test('wheel over the sidebar moves the selection', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible();

    await createSession(kirby, 'wheel-a');
    await createSession(kirby, 'wheel-b');

    const a = sidebarLocator(kirby.term.page, 'wheel-a');
    const b = sidebarLocator(kirby.term.page, 'wheel-b');
    await expect(b.selected().first()).toBeVisible({ timeout: 10_000 });

    await kirby.term.write(SIDEBAR_WHEEL_UP);
    await expect(a.selected().first()).toBeVisible({ timeout: 10_000 });

    await kirby.term.write(SIDEBAR_WHEEL_DOWN);
    await expect(b.selected().first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Sidebar click-to-select', () => {
  test('clicking an item row selects it', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await createSession(kirby, 'click-a');
    await createSession(kirby, 'click-b');

    const a = sidebarLocator(kirby.term.page, 'click-a');
    const b = sidebarLocator(kirby.term.page, 'click-b');
    await expect(b.selected().first()).toBeVisible({ timeout: 10_000 });

    // Screen rows: 1 = border/title, 2 = "Worktrees" header,
    // 3 = click-a, 4 = click-b (no PR-badge rows without VCS config).
    await kirby.term.write('\x1b[<0;10;3M\x1b[<0;10;3m');
    await expect(a.selected().first()).toBeVisible({ timeout: 10_000 });

    await kirby.term.write('\x1b[<0;10;4M\x1b[<0;10;4m');
    await expect(b.selected().first()).toBeVisible({ timeout: 10_000 });
  });
});
