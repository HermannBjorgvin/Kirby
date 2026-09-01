import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import {
  addExternalWorktree,
  cleanupExternalSessions,
  startExternalTmuxSession,
  tmuxAvailable,
  uniqueExternalBranch,
} from './setup/external.js';

/**
 * The desktop half of noticing work created outside the app: a worktree
 * added with plain git, and an agent already running in a tmux session
 * the app never started.
 *
 * Nothing is clicked before the assertions — that is the feature. What
 * this can show that the unit suites cannot is that the host's scan is
 * running against the open repo, and that an attach goes through
 * `launchAgent`, so the session is registered with the host and its
 * output relay rather than merely spawned.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

const BANNER = 'external-agent-was-already-running';

test.use({ kirbyConfig: { terminalBackend: 'tmux' } });

test.describe('Discovering work created outside the app', () => {
  let branches: string[] = [];

  test.beforeEach(() => {
    branches = [];
  });

  test.afterEach(({ desktop }) => {
    cleanupExternalSessions(desktop.repoPath, branches, desktop.homeDir);
  });

  test('a worktree added from outside appears in the sidebar', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    const branch = uniqueExternalBranch();
    branches.push(branch);
    await expect(sidebarRow(page, new RegExp(branch))).toHaveCount(0);

    addExternalWorktree(repoPath, branch);

    await expect(sidebarRow(page, new RegExp(branch))).toBeVisible({
      timeout: 30_000,
    });
  });

  test('an agent already running in tmux is picked up as a live session', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const branch = uniqueExternalBranch();
    branches.push(branch);
    const worktreePath = addExternalWorktree(repoPath, branch);
    startExternalTmuxSession({
      repoPath,
      homeDir,
      branch,
      worktreePath,
      command: `printf '%s\\n' ${BANNER}; sleep 120`,
    });

    // Registered with the host, not merely spawned: listSessions only
    // reports sessions this host launched and is relaying output for.
    await expect
      .poll(
        async () => {
          const sessions = await page.evaluate(() =>
            window.kirby.listSessions()
          );
          return sessions.find((s) => s.name === branch)?.running ?? false;
        },
        { timeout: 30_000, intervals: [500] }
      )
      .toBe(true);

    await expect(sidebarRow(page, new RegExp(branch))).toBeVisible();
  });

  // `new-session -A` attached to the agent that was already there: its
  // output predates the app knowing the session existed, and is redrawn
  // on attach. A fresh spawn would have run `aiCommand` instead.
  test('opening the session shows the agent that was already running', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const branch = uniqueExternalBranch();
    branches.push(branch);
    const worktreePath = addExternalWorktree(repoPath, branch);
    startExternalTmuxSession({
      repoPath,
      homeDir,
      branch,
      worktreePath,
      command: `printf '%s\\n' ${BANNER}; sleep 120`,
    });

    await sidebarRow(page, new RegExp(branch)).click({ timeout: 30_000 });

    await expect(page.getByText(BANNER).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('kirby-fake-agent-ready')).toHaveCount(0);
  });
});
