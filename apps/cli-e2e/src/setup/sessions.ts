import { expect, type KirbyTerm } from '../fixtures/kirby.js';

/**
 * Create a session via the branch picker. After this returns, the
 * session row is visible in the sidebar with the user still focused on
 * the sidebar (the PTY has NOT been started yet — use Tab to start +
 * focus the terminal).
 */
export async function createSession(
  term: KirbyTerm,
  branchName: string
): Promise<void> {
  // One 'c' can be lost when it bunches into the same stdin chunk as
  // a preceding Ctrl+Space — the escape fires but Ink's sidebar
  // useInput is still inactive in that React tick, so the 'c' is
  // dispatched against the terminal-focused context and dropped. One
  // retry on the next render cycle is enough; if it takes more than
  // that, something else is broken.
  await expect(async () => {
    await term.type('c');
    await expect(term.getByText('Branch Picker')).toBeVisible({
      timeout: 1_000,
    });
  }).toPass({ timeout: 2_500, intervals: [400] });
  await term.type(branchName);
  await expect(term.getByText(/\(new branch\)/).first()).toBeVisible({
    timeout: 5_000,
  });
  // Let React re-render so useInput closure captures the updated filter.
  await term.page.waitForTimeout(2_000);
  await term.press('Enter');
  await expect(term.getByText('Branch Picker')).not.toBeVisible({
    timeout: 5_000,
  });
  await expect(term.getByText(branchName).first()).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Press `key` repeatedly until `predicate` reports the action landed.
 *
 * A keypress can be swallowed when it arrives in the same stdin chunk as
 * a preceding Ctrl+Space: the escape fires, but Ink's sidebar useInput
 * isn't active yet for that React tick, so the key is dispatched against
 * the terminal context and dropped. Waiting longer never recovers it —
 * the key has to be sent again. (`createSession` retries around the same
 * failure mode for 'c'.)
 *
 * Retrying also absorbs a genuinely slow effect, so this covers both the
 * lost-key and slow-action cases with one mechanism.
 *
 * Only for idempotent actions — the key may be delivered more than once.
 */
export async function pressUntil(
  term: KirbyTerm,
  key: string,
  predicate: () => boolean | Promise<boolean>,
  opts: { timeout?: number } = {}
): Promise<void> {
  await expect(async () => {
    await term.press(key);
    expect(await predicate()).toBe(true);
  }).toPass({
    timeout: opts.timeout ?? 20_000,
    intervals: [250, 500, 1_000],
  });
}

/**
 * Wait for the user to be focused on the sidebar. The pane title only
 * appends "(ctrl+space to exit)" while terminal-focused (see
 * `getPaneTitle` in focus.ts), so its absence is the cheapest
 * sidebar-focused signal that works regardless of `autoHideSidebar`.
 *
 * Use this after `term.write('\x00')` to escape from a terminal: the
 * write call returns when CDP acknowledges the page.evaluate, but the
 * actual focus change requires a WS roundtrip + React reconciliation.
 * Without this wait, the next keystroke can race the escape and end
 * up in the still-focused PTY.
 */
export async function waitForSidebarFocused(term: KirbyTerm): Promise<void> {
  await expect(term.getByText(/ctrl\+space to exit/)).not.toBeVisible({
    timeout: 5_000,
  });
}
