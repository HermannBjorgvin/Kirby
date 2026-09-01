import { test, expect, fakeAgentCommand } from './fixtures/kirby.js';
import { sidebarLocator } from './setup/sidebar.js';
import {
  addExternalWorktree,
  cleanupTmuxSessions,
  startExternalTmuxSession,
  tmuxAvailable,
  uniqueTmuxBranch,
} from './setup/tmux.js';

/**
 * Worktrees and agent sessions can be created without this Kirby being
 * involved — a second Kirby, a script, or someone running `git worktree
 * add` and `tmux new-session` at a shell. This file drives that from the
 * outside while the TUI is already running and asserts it catches up on
 * its own.
 *
 * The unit suites cover the decisions (`libs/core/src/lib/discovery`);
 * what only an e2e can show is that the scan is actually running inside
 * the app, that the name it composes matches the one an operator would
 * type, and that attaching reaches the agent that was already there
 * rather than starting a second one.
 *
 * No key is pressed before the assertion in any of these tests. That is
 * the point: the whole feature is that the user does not have to do
 * anything.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

const BANNER = 'external-agent-was-already-running';

test.use({
  kirbyConfig: {
    terminalBackend: 'tmux',
    aiCommand: fakeAgentCommand({ banner: 'kirby-fake-agent-ready' }),
    keybindPreset: 'vim',
  },
});

test.describe('Discovering sessions created outside Kirby', () => {
  let branches: string[] = [];

  test.beforeEach(() => {
    branches = [];
  });

  // Kirby's own exit path detaches rather than kills, so anything left
  // running here would outlive the test.
  test.afterEach(({ kirby }) => {
    cleanupTmuxSessions(branches, kirby.homeDir);
  });

  test('a worktree added from outside appears in the sidebar', async ({
    kirby,
  }) => {
    const branch = uniqueTmuxBranch();
    branches.push(branch);
    const row = sidebarLocator(kirby.term.page, branch);
    await expect(row.any()).toHaveCount(0);

    addExternalWorktree(kirby.repoPath, branch);

    await expect(row.any().first()).toBeVisible({ timeout: 20_000 });
  });

  test('a tmux session started from outside shows as running', async ({
    kirby,
  }) => {
    const branch = uniqueTmuxBranch();
    branches.push(branch);
    const worktreePath = addExternalWorktree(kirby.repoPath, branch);
    startExternalTmuxSession({
      repoPath: kirby.repoPath,
      homeDir: kirby.homeDir,
      branch,
      worktreePath,
      command: `printf '%s\\n' ${BANNER}; sleep 120`,
    });

    // A running indicator, not merely a row: the row would show up for
    // the bare worktree too.
    await expect(
      sidebarLocator(kirby.term.page, branch).running().first()
    ).toBeVisible({ timeout: 30_000 });
  });

  // The strongest claim in the feature: `new-session -A` attached to the
  // agent that was already there. Output the external session printed
  // before Kirby knew it existed is redrawn on attach — a fresh spawn
  // would run `aiCommand` instead and print the fake agent's banner.
  test('attaching reaches the running agent rather than starting a new one', async ({
    kirby,
  }) => {
    const branch = uniqueTmuxBranch();
    branches.push(branch);
    const worktreePath = addExternalWorktree(kirby.repoPath, branch);
    startExternalTmuxSession({
      repoPath: kirby.repoPath,
      homeDir: kirby.homeDir,
      branch,
      worktreePath,
      command: `printf '%s\\n' ${BANNER}; sleep 120`,
    });

    await expect(
      sidebarLocator(kirby.term.page, branch).running().first()
    ).toBeVisible({ timeout: 30_000 });

    // Only now is a key pressed — to look at what was attached to.
    await kirby.term.press('Tab');
    await expect(kirby.term.getByText(BANNER).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(kirby.term.getByText('kirby-fake-agent-ready')).toHaveCount(0);
  });

  test('a session killed from outside stops showing as running', async ({
    kirby,
  }) => {
    const branch = uniqueTmuxBranch();
    branches.push(branch);
    const worktreePath = addExternalWorktree(kirby.repoPath, branch);
    startExternalTmuxSession({
      repoPath: kirby.repoPath,
      homeDir: kirby.homeDir,
      branch,
      worktreePath,
      command: `printf '%s\\n' ${BANNER}; sleep 120`,
    });
    const row = sidebarLocator(kirby.term.page, branch);
    await expect(row.running().first()).toBeVisible({ timeout: 30_000 });

    cleanupTmuxSessions([branch], kirby.homeDir);

    // The row stays — the worktree is still there — but the agent
    // behind it is gone.
    await expect(row.running()).toHaveCount(0, { timeout: 30_000 });
    await expect(row.any().first()).toBeVisible();
  });
});
