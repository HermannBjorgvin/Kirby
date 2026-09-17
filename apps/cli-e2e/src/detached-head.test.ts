import { execSync } from 'node:child_process';
import { test, expect } from './fixtures/n10.js';
import { tabIntoSession } from './setup/sessions.js';
import { createTestRepo, registerCleanup } from './setup/git-repo.js';
import { sidebarLocator } from './setup/sidebar.js';

// ── Module-scope setup ─────────────────────────────────────────────
// A repo with a detached-HEAD worktree under .claude/worktrees/. The
// worktree directory name (no branch) is what should drive the session.
const WORKTREE_NAME = 'master-test-temp';

const repoDir = createTestRepo();
registerCleanup(repoDir);
execSync(
  `git worktree add --detach ".claude/worktrees/${WORKTREE_NAME}" HEAD`,
  { cwd: repoDir, stdio: 'pipe' }
);

test.use({
  n10RepoPath: repoDir,
  n10Config: {
    aiCommand: 'echo n10-detached-active && sleep 300',
    keybindPreset: 'vim',
  },
});

test.describe('Detached-HEAD worktree', () => {
  // Repro: a worktree whose HEAD is detached has no branch, so
  // `git worktree list --porcelain` emits a `detached` marker instead
  // of a `branch refs/heads/...` line. Pre-fix the session name was
  // derived as `branchToSessionName('') === ''`, rendering a blank
  // sidebar row and breaking the worktree lookup that starts a session.
  test('appears in the sidebar by its directory name', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();

    // The detached worktree is the only session — it must show up by
    // its directory name. Pre-fix the row title was an empty string
    // (branchToSessionName('')), so this text never appeared.
    await expect(
      sidebarLocator(n10.term.page, WORKTREE_NAME).any()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('can start a session in it', async ({ n10 }) => {
    await expect(
      sidebarLocator(n10.term.page, WORKTREE_NAME).any()
    ).toBeVisible({ timeout: 15_000 });

    // The only row is auto-selected. Tab opens the session menu and
    // Enter starts the PTY and focuses the terminal. Pre-fix the
    // worktree lookup failed (empty name mismatch) so no PTY ever
    // spawned.
    await tabIntoSession(n10.term);
    await expect(n10.term.getByText('ctrl+space to exit').first()).toBeVisible({
      timeout: 10_000,
    });

    // The agent ran in the worktree → its banner is on screen.
    await expect(n10.term.getByText('n10-detached-active').first()).toBeVisible(
      { timeout: 10_000 }
    );
  });
});
