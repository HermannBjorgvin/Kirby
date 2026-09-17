import { test, expect, fakeAgentCommand } from './fixtures/n10.js';
import { sidebarLocator } from './setup/sidebar.js';
import {
  addExternalWorktree,
  cleanupTmuxSessions,
  startExternalTmuxSession,
  tmuxAvailable,
  uniqueTmuxBranch,
} from './setup/tmux.js';

/**
 * Worktrees and agent sessions can be created without this n10 being
 * involved — a second n10, an Orchestra spawn, or someone running `git
 * worktree add` and a tagged `tmux new-session` at a shell. This file
 * drives that from the outside while the TUI is already running and
 * asserts it catches up on its own.
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
  n10Config: {
    aiCommand: fakeAgentCommand({ banner: 'n10-fake-agent-ready' }),
    keybindPreset: 'vim',
  },
});

test.describe('Discovering sessions created outside n10', () => {
  let branches: string[] = [];

  test.beforeEach(() => {
    branches = [];
  });

  // n10's own exit path detaches rather than kills, so anything left
  // running here would outlive the test.
  test.afterEach(({ n10 }) => {
    cleanupTmuxSessions(branches, n10.homeDir);
  });

  test('a worktree added from outside appears in the sidebar', async ({
    n10,
  }) => {
    const branch = uniqueTmuxBranch();
    branches.push(branch);
    const row = sidebarLocator(n10.term.page, branch);
    await expect(row.any()).toHaveCount(0);

    addExternalWorktree(n10.repoPath, branch);

    await expect(row.any().first()).toBeVisible({ timeout: 20_000 });
  });

  test('a tmux session started from outside shows as running', async ({
    n10,
  }) => {
    const branch = uniqueTmuxBranch();
    branches.push(branch);
    const worktreePath = addExternalWorktree(n10.repoPath, branch);
    startExternalTmuxSession({
      repoPath: n10.repoPath,
      homeDir: n10.homeDir,
      branch,
      worktreePath,
      command: `printf '%s\\n' ${BANNER}; sleep 120`,
    });

    // A running indicator, not merely a row: the row would show up for
    // the bare worktree too.
    await expect(
      sidebarLocator(n10.term.page, branch).running().first()
    ).toBeVisible({ timeout: 30_000 });
  });

  // The strongest claim in the feature: the tag resolver found the
  // agent that was already there and the backend attached to it. Output
  // the external session printed before n10 knew it existed is redrawn
  // on attach — a fresh spawn would run `aiCommand` instead and print
  // the fake agent's banner.
  test('attaching reaches the running agent rather than starting a new one', async ({
    n10,
  }) => {
    const branch = uniqueTmuxBranch();
    branches.push(branch);
    const worktreePath = addExternalWorktree(n10.repoPath, branch);
    startExternalTmuxSession({
      repoPath: n10.repoPath,
      homeDir: n10.homeDir,
      branch,
      worktreePath,
      command: `printf '%s\\n' ${BANNER}; sleep 120`,
    });

    await expect(
      sidebarLocator(n10.term.page, branch).running().first()
    ).toBeVisible({ timeout: 30_000 });

    // Only now is a key pressed — to look at what was attached to.
    await n10.term.press('Tab');
    await expect(n10.term.getByText(BANNER).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(n10.term.getByText('n10-fake-agent-ready')).toHaveCount(0);
  });

  test('a session killed from outside stops showing as running', async ({
    n10,
  }) => {
    const branch = uniqueTmuxBranch();
    branches.push(branch);
    const worktreePath = addExternalWorktree(n10.repoPath, branch);
    startExternalTmuxSession({
      repoPath: n10.repoPath,
      homeDir: n10.homeDir,
      branch,
      worktreePath,
      command: `printf '%s\\n' ${BANNER}; sleep 120`,
    });
    const row = sidebarLocator(n10.term.page, branch);
    await expect(row.running().first()).toBeVisible({ timeout: 30_000 });

    cleanupTmuxSessions([branch], n10.homeDir);

    // The row stays — the worktree is still there — but the agent
    // behind it is gone.
    await expect(row.running()).toHaveCount(0, { timeout: 30_000 });
    await expect(row.any().first()).toBeVisible();
  });
});
