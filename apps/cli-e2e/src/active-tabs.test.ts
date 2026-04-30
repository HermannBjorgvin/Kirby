import { test, expect } from './fixtures/kirby.js';
import { sidebarLocator } from './setup/sidebar.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';

// Quiet agents that just print a banner then sleep keep the PTYs alive
// without producing the bursty output the activity tests need —
// perfect for exercising input plumbing.
test.use({
  kirbyConfig: {
    aiCommand: 'echo kirby-session-active && sleep 300',
    autoHideSidebar: false,
    keybindPreset: 'vim',
  },
});

test.describe('Active-session tab bar', () => {
  test('Ctrl+Space + digit selects the Nth running tab and focuses terminal', async ({
    kirby,
  }) => {
    // 1. Create `alpha` and start its PTY.
    await createSession(kirby.term, 'alpha');
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('kirby-session-active').first()
    ).toBeVisible({ timeout: 10_000 });
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);

    // 2. Create `beta` and start its PTY. Focus is now in beta's
    //    terminal; both sessions are running.
    await createSession(kirby.term, 'beta');
    await kirby.term.press('Tab');
    await expect(kirby.term.getByText(/Agent.*beta/).first()).toBeVisible({
      timeout: 10_000,
    });

    // 3. The tab bar above the agent terminal lists both running sessions
    //    in sidebar order (alpha → 1, beta → 2) since neither has a PR.
    await expect(kirby.term.getByText('1 alpha').first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(kirby.term.getByText('2 beta').first()).toBeVisible({
      timeout: 5_000,
    });

    // 4. Ctrl+Space focuses the sidebar; '1' jumps to alpha and lands
    //    focus straight back in the terminal.
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);
    await kirby.term.type('1');

    // Selection moved to alpha (◉ ring icon in front of the row).
    await expect(
      sidebarLocator(kirby.term.page, 'alpha').selected()
    ).toBeVisible({ timeout: 5_000 });
    // Pane title's "(ctrl+space to exit)" hint only renders when the
    // terminal is focused — its presence proves the focus jump.
    await expect(kirby.term.getByText(/ctrl\+space to exit/)).toBeVisible({
      timeout: 5_000,
    });
  });

  // Covers the v2 UX changes: spawn-time ordering, sidebar tab-number
  // prefix, middle truncation. Spawns three sessions in a known order,
  // kills the middle one (verifies remaining tabs compact), and
  // restarts it (verifies it lands at the END, not back in its old
  // slot — browser-tab semantics).
  test('spawn order is preserved across kill+restart, sidebar prefixes match', async ({
    kirby,
  }) => {
    const longBranch = 'this-is-a-very-long-branch-name';
    // Middle-truncated form: head=8 ('this-is-'), tail=7 ('ch-name').
    const longTruncated = 'this-is-…ch-name';

    // Helper: assert the tab bar / sidebar shows `<digit> <label>` for
    // each entry. Both surfaces are rendered as terminal text and end
    // up in the page DOM as plain characters in `.term-row`s — getByText
    // with `.first()` is enough since a row appears in only one pane.
    const expectTab = async (digit: string, label: string) => {
      await expect(
        kirby.term.getByText(`${digit} ${label}`).first()
      ).toBeVisible({ timeout: 5_000 });
    };
    const expectNoTab = async (digit: string, label: string) => {
      await expect(kirby.term.getByText(`${digit} ${label}`)).not.toBeVisible({
        timeout: 5_000,
      });
    };

    // 1. Spawn order: alpha → long → bravo. Tab into each so the PTY
    //    starts before moving on (createSession alone doesn't spawn).
    await createSession(kirby.term, 'alpha');
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('kirby-session-active').first()
    ).toBeVisible({ timeout: 10_000 });
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);

    await createSession(kirby.term, longBranch);
    await kirby.term.press('Tab');
    await expect(kirby.term.getByText(/Agent.*ch-name/).first()).toBeVisible({
      timeout: 10_000,
    });
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);

    await createSession(kirby.term, 'bravo');
    await kirby.term.press('Tab');
    await expect(kirby.term.getByText(/Agent.*bravo/).first()).toBeVisible({
      timeout: 10_000,
    });
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);

    // 2. Tab bar follows spawn order (NOT alphabetical, which would put
    //    `bravo` at tab 2). Long branch is middle-truncated.
    await expectTab('1', 'alpha');
    await expectTab('2', longTruncated);
    await expectTab('3', 'bravo');

    // 3. Sidebar prefixes match the tab bar digits. The sidebar shows
    //    `<digit> <icon> <full-branch-name>` where icon is `●` (running,
    //    not selected) or `◉` (selected + running). The icon between the
    //    digit and the name distinguishes the sidebar row from the tab
    //    bar's `<digit> <label>` rendering.
    await expect(kirby.term.getByText(/1 [●◉] alpha/).first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      kirby.term.getByText(new RegExp(`2 [●◉] ${longBranch}`)).first()
    ).toBeVisible({ timeout: 5_000 });
    await expect(kirby.term.getByText(/3 [●◉] bravo/).first()).toBeVisible({
      timeout: 5_000,
    });

    // 4. Sidebar order is alphabetical (alpha, bravo, long-branch);
    //    bravo is currently selected, so vim 'j' navigates down to the
    //    long-branch row, which we then kill via Shift+K.
    await kirby.term.type('j');
    await expect(
      sidebarLocator(kirby.term.page, longBranch).selected()
    ).toBeVisible({ timeout: 5_000 });
    await kirby.term.type('K'); // Shift+K kills the selected agent

    // Tab bar compacts: alpha stays at 1, bravo shifts up from 3 to 2.
    await expectTab('1', 'alpha');
    await expectTab('2', 'bravo');
    await expectNoTab('2', longTruncated);
    await expectNoTab('3', 'bravo');

    // 5. Restart the long-branch agent (Tab on its still-selected row).
    //    It must land at the END (tab 3), not back in its original
    //    slot at tab 2 — that's browser-tab semantics.
    await kirby.term.press('Tab');
    await expect(kirby.term.getByText(/Agent.*ch-name/).first()).toBeVisible({
      timeout: 10_000,
    });
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);

    await expectTab('1', 'alpha');
    await expectTab('2', 'bravo');
    await expectTab('3', longTruncated);
    // bravo is no longer at tab 3 (compacted up earlier, now back to 2).
    await expectNoTab('3', 'bravo');
  });
});
