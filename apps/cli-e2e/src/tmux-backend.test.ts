import { test, expect, fakeAgentCommand } from './fixtures/n10.js';
import { wtermHost } from './setup/constants.js';
import {
  createSession,
  pressUntil,
  waitForSidebarFocused,
} from './setup/sessions.js';
import {
  cleanupTmuxSessions,
  n10SessionExists,
  tmuxAvailable,
  uniqueTmuxBranch,
} from './setup/tmux.js';

/**
 * End-to-end coverage of the tmux backend driving the real TUI.
 *
 * The lib-level suites (libs/terminal-tmux) already cover the backend in
 * isolation against a real tmux binary. What only this file can prove is
 * that n10 *selects* tmux from config, composes the session name, and
 * routes its kill/quit paths to the right teardown — i.e. that the wiring
 * between the app and the backend is real.
 *
 * Skipped when tmux is missing so the offline `nx e2e` leg still passes on
 * a machine without it. Ubuntu GitHub Actions runners ship tmux, so this
 * runs in CI.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

test.use({
  n10Config: {
    aiCommand: fakeAgentCommand({
      banner: 'n10-fake-agent-ready',
      bursts: 'inf',
      burstMs: 500,
      idleMs: 200,
    }),
    keybindPreset: 'vim',
  },
});

interface Status {
  ptyAlive: boolean;
}

async function fetchStatus(baseURL: string): Promise<Status> {
  const r = await fetch(`${baseURL}/status`);
  return (await r.json()) as Status;
}

test.describe('Tmux backend (e2e)', () => {
  // Branches whose tmux sessions need reaping. Populated per test, since
  // n10's own exit path leaves them running by design.
  let branches: string[] = [];

  test.beforeEach(() => {
    branches = [];
  });

  // Requests `n10` so the reap runs against the test's own tmux socket
  // (TMUX_TMPDIR=homeDir). afterEach runs before fixture teardown, so the
  // temp home — and the socket inside it — still exists here.
  test.afterEach(({ n10 }) => {
    cleanupTmuxSessions(branches, n10.homeDir);
  });

  test('starting an agent creates a real tmux session and streams its output', async ({
    n10,
  }) => {
    const branch = uniqueTmuxBranch();
    branches.push(branch);

    await createSession(n10.term, branch, { start: true });

    // Output arriving at all proves the whole chain: n10 → local PTY →
    // tmux client → tmux server → fake agent, and back.
    await expect(
      n10.term.getByText('n10-fake-agent-ready').first()
    ).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(() => n10SessionExists(branch, n10.homeDir), {
        timeout: 10_000,
        intervals: [250],
      })
      .toBe(true);
  });

  // The leak this guards: killSession must call the backend's kill(), not
  // dispose(). With dispose() the UI would look identical — row gone, pane
  // cleared — while the tmux session kept running the agent forever.
  test('kill-agent destroys the tmux session rather than orphaning it', async ({
    n10,
  }) => {
    const branch = uniqueTmuxBranch();
    branches.push(branch);

    await createSession(n10.term, branch, { start: true });
    await expect(
      n10.term.getByText('n10-fake-agent-ready').first()
    ).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => n10SessionExists(branch, n10.homeDir), {
        timeout: 10_000,
        intervals: [250],
      })
      .toBe(true);

    // Escape to the sidebar so the keypress is a sidebar action.
    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);

    // vim preset binds sidebar.kill-agent to 'K'. Retried: a key following
    // Ctrl+Space can be dropped before Ink's sidebar useInput is active,
    // and a longer wait can't recover a key that never arrived. Safe to
    // repeat — killSession no-ops once the registry entry is gone.
    await pressUntil(
      n10.term,
      'K',
      () => !n10SessionExists(branch, n10.homeDir)
    );
  });

  // The feature's whole reason to exist: quitting n10 must leave the
  // tmux session running so the next launch reattaches. killAll() calls
  // dispose() for exactly this reason.
  test('quitting n10 leaves the tmux session alive for the next launch', async ({
    n10,
    baseURL,
  }) => {
    const host = wtermHost(baseURL);
    const branch = uniqueTmuxBranch();
    branches.push(branch);

    await createSession(n10.term, branch, { start: true });
    await expect(
      n10.term.getByText('n10-fake-agent-ready').first()
    ).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => n10SessionExists(branch, n10.homeDir), {
        timeout: 10_000,
        intervals: [250],
      })
      .toBe(true);

    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);

    // 'q' quits. Wait for n10's own PTY to be gone before judging the
    // tmux session, otherwise we might sample before teardown ran at all.
    await pressUntil(
      n10.term,
      'q',
      async () => !(await fetchStatus(host)).ptyAlive
    );

    // n10 is gone; the agent's tmux session is not.
    expect(n10SessionExists(branch, n10.homeDir)).toBe(true);
  });

  test('Settings does not offer a terminal backend selector', async ({
    n10,
  }) => {
    await n10.term.press('s');
    await expect(n10.term.getByText('Settings').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(n10.term.getByText('Terminal Backend')).toHaveCount(0);
  });
});
