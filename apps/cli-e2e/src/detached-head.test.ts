import { execSync } from 'node:child_process';
import { test, expect } from './fixtures/kirby.js';
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
  kirbyRepoPath: repoDir,
  kirbyConfig: {
    aiCommand: 'echo kirby-detached-active && sleep 300',
    keybindPreset: 'vim',
  },
});

test.describe('Detached-HEAD worktree', () => {
  // Repro: a worktree whose HEAD is detached has no branch, so
  // `git worktree list --porcelain` emits a `detached` marker instead
  // of a `branch refs/heads/...` line. Pre-fix the session name was
  // derived as `branchToSessionName('') === ''`, rendering a blank
  // sidebar row and breaking the worktree lookup that starts a session.
  test('appears in the sidebar by its directory name', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();

    // The detached worktree is the only session — it must show up by
    // its directory name. Pre-fix the row title was an empty string
    // (branchToSessionName('')), so this text never appeared.
    await expect(
      sidebarLocator(kirby.term.page, WORKTREE_NAME).any()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('can start a session in it', async ({ kirby }) => {
    await expect(
      sidebarLocator(kirby.term.page, WORKTREE_NAME).any()
    ).toBeVisible({ timeout: 15_000 });

    // The only row is auto-selected. Tab starts the PTY and focuses the
    // terminal. Pre-fix the worktree lookup failed (empty name mismatch)
    // so no PTY ever spawned.
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('ctrl+space to exit').first()
    ).toBeVisible({ timeout: 10_000 });

    // The agent ran in the worktree → its banner is on screen.
    await expect(
      kirby.term.getByText('kirby-detached-active').first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
