import { test, expect, fakeAgentCommand } from './fixtures/kirby.js';
import { wtermHost } from './setup/constants.js';
import {
  createSession,
  pressUntil,
  waitForSidebarFocused,
} from './setup/sessions.js';
import {
  cleanupTmuxSessions,
  kirbySessionExists,
  tmuxAvailable,
  uniqueTmuxBranch,
} from './setup/tmux.js';

/**
 * End-to-end coverage of the tmux backend driving the real TUI.
 *
 * The lib-level suites (libs/terminal-tmux) already cover the backend in
 * isolation against a real tmux binary. What only this file can prove is
 * that Kirby *selects* tmux from config, composes the session name, and
 * routes its kill/quit paths to the right teardown — i.e. that the wiring
 * between the app and the backend is real.
 *
 * Skipped when tmux is missing so the offline `nx e2e` leg still passes on
 * a machine without it. Ubuntu GitHub Actions runners ship tmux, so this
 * runs in CI.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

test.use({
  kirbyConfig: {
    terminalBackend: 'tmux',
    aiCommand: fakeAgentCommand({
      banner: 'kirby-fake-agent-ready',
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
  // Kirby's own exit path leaves them running by design.
  let branches: string[] = [];

  test.beforeEach(() => {
    branches = [];
  });

  // Requests `kirby` so the reap runs against the test's own tmux socket
  // (TMUX_TMPDIR=homeDir). afterEach runs before fixture teardown, so the
  // temp home — and the socket inside it — still exists here.
  test.afterEach(({ kirby }) => {
    cleanupTmuxSessions(branches, kirby.homeDir);
  });

  test('starting an agent creates a real tmux session and streams its output', async ({
    kirby,
  }) => {
    const branch = uniqueTmuxBranch();
    branches.push(branch);

    await createSession(kirby.term, branch, { start: true });

    // Output arriving at all proves the whole chain: Kirby → local PTY →
    // tmux client → tmux server → fake agent, and back.
    await expect(
      kirby.term.getByText('kirby-fake-agent-ready').first()
    ).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(() => kirbySessionExists(branch, kirby.homeDir), {
        timeout: 10_000,
        intervals: [250],
      })
      .toBe(true);
  });

  // The leak this guards: killSession must call the backend's kill(), not
  // dispose(). With dispose() the UI would look identical — row gone, pane
  // cleared — while the tmux session kept running the agent forever.
  test('kill-agent destroys the tmux session rather than orphaning it', async ({
    kirby,
  }) => {
    const branch = uniqueTmuxBranch();
    branches.push(branch);

    await createSession(kirby.term, branch, { start: true });
    await expect(
      kirby.term.getByText('kirby-fake-agent-ready').first()
    ).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => kirbySessionExists(branch, kirby.homeDir), {
        timeout: 10_000,
        intervals: [250],
      })
      .toBe(true);

    // Escape to the sidebar so the keypress is a sidebar action.
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);

    // vim preset binds sidebar.kill-agent to 'K'. Retried: a key following
    // Ctrl+Space can be dropped before Ink's sidebar useInput is active,
    // and a longer wait can't recover a key that never arrived. Safe to
    // repeat — killSession no-ops once the registry entry is gone.
    await pressUntil(
      kirby.term,
      'K',
      () => !kirbySessionExists(branch, kirby.homeDir)
    );
  });

  // The feature's whole reason to exist: quitting Kirby must leave the
  // tmux session running so the next launch reattaches. killAll() calls
  // dispose() for exactly this reason.
  test('quitting Kirby leaves the tmux session alive for the next launch', async ({
    kirby,
    baseURL,
  }) => {
    const host = wtermHost(baseURL);
    const branch = uniqueTmuxBranch();
    branches.push(branch);

    await createSession(kirby.term, branch, { start: true });
    await expect(
      kirby.term.getByText('kirby-fake-agent-ready').first()
    ).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => kirbySessionExists(branch, kirby.homeDir), {
        timeout: 10_000,
        intervals: [250],
      })
      .toBe(true);

    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);

    // 'q' quits. Wait for Kirby's own PTY to be gone before judging the
    // tmux session, otherwise we might sample before teardown ran at all.
    await pressUntil(
      kirby.term,
      'q',
      async () => !(await fetchStatus(host)).ptyAlive
    );

    // Kirby is gone; the agent's tmux session is not.
    expect(kirbySessionExists(branch, kirby.homeDir)).toBe(true);
  });

  test('Settings reports the active backend as Tmux', async ({ kirby }) => {
    await kirby.term.press('s');
    await expect(kirby.term.getByText('Settings').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(kirby.term.getByText('Terminal Backend').first()).toBeVisible({
      timeout: 10_000,
    });
    // Rendered from config — proves the config value reached the UI rather
    // than the panel defaulting to the first preset.
    await expect(kirby.term.getByText(/\bTmux\b/).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
