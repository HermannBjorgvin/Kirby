import { expect, type KirbyTerm } from '../fixtures/kirby.js';
import { settleFor } from './waits.js';

/**
 * Create a session via the branch picker. Creating a worktree lands the
 * user in the new session's menu.
 *
 * With `start: true`, Enter takes the menu's default "Start/Continue
 * session" row, so the helper returns with the PTY spawning and the
 * terminal focused — follow with an assertion on the agent's output.
 *
 * Without it, the menu is dismissed: the session row is visible in the
 * sidebar with the user still focused on the sidebar and the PTY NOT
 * started (use `tabIntoSession` later to start + focus the terminal).
 */
export async function createSession(
  term: KirbyTerm,
  branchName: string,
  opts: { start?: boolean } = {}
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
  await settleFor(
    term.page,
    2_000,
    "Ink's useInput captured the old filter until the next render"
  );
  await term.press('Enter');
  await expect(term.getByText('Branch Picker')).not.toBeVisible({
    timeout: 5_000,
  });
  if (opts.start) {
    await startFromSessionMenu(term);
    return;
  }
  await dismissSessionMenu(term);
  await expect(term.getByText(branchName).first()).toBeVisible({
    timeout: 10_000,
  });
}

const MENU_PROMPT = 'What would you like to do?';

/**
 * Wait for the session menu (it opens once worktree creation finishes,
 * so it doubles as the "creation done" signal) and take its default
 * "Start/Continue session" row. Returns with the menu gone and the
 * PTY spawning — follow with an assertion on the agent's output.
 */
export async function startFromSessionMenu(term: KirbyTerm): Promise<void> {
  await expect(term.getByText(MENU_PROMPT)).toBeVisible({ timeout: 10_000 });
  await term.press('Enter');
  await expect(term.getByText(MENU_PROMPT)).not.toBeVisible({
    timeout: 10_000,
  });
}

/** Wait for the session menu and dismiss it, staying on the sidebar. */
export async function dismissSessionMenu(term: KirbyTerm): Promise<void> {
  await expect(term.getByText(MENU_PROMPT)).toBeVisible({ timeout: 10_000 });
  await term.press('Escape');
  await expect(term.getByText(MENU_PROMPT)).not.toBeVisible({
    timeout: 5_000,
  });
}

/**
 * Start the selected (non-running) session: Tab opens the session menu,
 * Enter takes the default "Start/Continue session" row with the default
 * agent. After this returns the menu is gone and the PTY is spawning —
 * follow with an assertion on the agent's output to confirm it's up.
 *
 * The Tab is retried until the menu shows (a Tab bunched into the same
 * stdin chunk as a preceding Ctrl+Space can be dropped — same failure
 * mode `createSession` retries around for 'c'). Re-sending Tab while
 * the menu is already open is a no-op, so the retry is safe.
 */
export async function tabIntoSession(term: KirbyTerm): Promise<void> {
  await expect(async () => {
    await term.press('Tab');
    await expect(term.getByText(MENU_PROMPT)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000, intervals: [400] });
  await term.press('Enter');
  await expect(term.getByText(MENU_PROMPT)).not.toBeVisible({
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
 * Wait for the user to be focused on the terminal — the pane title's
 * "(ctrl+space to exit)" suffix. Use this between a Tab that hands
 * focus to a running terminal and the first keystroke meant for the
 * agent: Ink can deliver both keys against one render snapshot, and
 * the keystroke then reaches the sidebar handler instead (an `x`
 * there is delete-branch).
 */
export async function waitForTerminalFocused(term: KirbyTerm): Promise<void> {
  await expect(term.getByText(/ctrl\+space to exit/).first()).toBeVisible({
    timeout: 5_000,
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
