import { test, expect } from './fixtures/n10.js';
import { sidebarLocator } from './setup/sidebar.js';
import { createSession } from './setup/sessions.js';

// Wheel + click over the sidebar column. The browser terminal has no
// mouse reporting, so raw SGR sequences are injected via term.write()
// — see wheel-scroll.test.ts for the main-pane counterpart.

const SIDEBAR_WHEEL_DOWN = '\x1b[<65;10;5M';
const SIDEBAR_WHEEL_UP = '\x1b[<64;10;5M';

test.use({
  n10Config: {
    aiCommand: 'echo n10-session-active && sleep 300',
    keybindPreset: 'vim',
  },
});

test.describe('Sidebar wheel scrolling', () => {
  test('wheel over the sidebar moves the selection', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();

    await createSession(n10.term, 'wheel-a');
    await createSession(n10.term, 'wheel-b');

    const a = sidebarLocator(n10.term.page, 'wheel-a');
    const b = sidebarLocator(n10.term.page, 'wheel-b');
    await expect(b.selected().first()).toBeVisible({ timeout: 10_000 });

    await n10.term.write(SIDEBAR_WHEEL_UP);
    await expect(a.selected().first()).toBeVisible({ timeout: 10_000 });

    await n10.term.write(SIDEBAR_WHEEL_DOWN);
    await expect(b.selected().first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Sidebar click-to-select', () => {
  test('clicking an item row selects it', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await createSession(n10.term, 'click-a');
    await createSession(n10.term, 'click-b');

    const a = sidebarLocator(n10.term.page, 'click-a');
    const b = sidebarLocator(n10.term.page, 'click-b');
    await expect(b.selected().first()).toBeVisible({ timeout: 10_000 });

    // Screen rows: 1 = border/title, 2 = "Worktrees" header,
    // 3 = click-a, 4 = click-b (no PR-badge rows without VCS config).
    await n10.term.write('\x1b[<0;10;3M\x1b[<0;10;3m');
    await expect(a.selected().first()).toBeVisible({ timeout: 10_000 });

    await n10.term.write('\x1b[<0;10;4M\x1b[<0;10;4m');
    await expect(b.selected().first()).toBeVisible({ timeout: 10_000 });
  });
});
