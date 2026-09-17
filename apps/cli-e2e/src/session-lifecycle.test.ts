import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import { dismissSessionMenu } from './setup/sessions.js';
import { settleFor } from './setup/waits.js';

test.use({
  n10Config: {
    aiCommand: 'echo n10-session-active && sleep 300',
    keybindPreset: 'vim',
  },
});

test.describe('Session Lifecycle – clean delete', () => {
  test('create session via branch picker, then delete with confirmation', async ({
    n10,
  }) => {
    const branchName = 'e2e-lifecycle';
    const sessionName = branchName;

    // 1. Empty state
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();

    // 2. Open branch picker, type a new branch name
    await n10.term.type('c');
    await expect(n10.term.getByText('Branch Picker')).toBeVisible();
    await n10.term.type(branchName);
    await expect(n10.term.getByText(/\(new branch\)/).first()).toBeVisible({
      timeout: 5_000,
    });

    // Let React re-render so useInput closure captures the updated filter.
    await settleFor(
      n10.term.page,
      2_000,
      "Ink's useInput captured the old filter until the next render"
    );
    await n10.term.press('Enter');

    // 3. Branch picker closes, the new session's menu opens; dismiss
    //    it and the session row is in the sidebar
    await expect(n10.term.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });
    await dismissSessionMenu(n10.term);
    await expect(n10.term.getByText(sessionName).first()).toBeVisible({
      timeout: 10_000,
    });

    // 4. Worktree directory was created on disk
    const worktreePath = join(
      n10.repoPath,
      '.claude',
      'worktrees',
      sessionName
    );
    expect(existsSync(worktreePath)).toBe(true);

    // 5. Press 'x' to delete — no remote tracking, so a confirm dialog
    //    appears. The confirm text wraps in a 100-col terminal, so match
    //    a short fragment that stays on one line.
    await n10.term.type('x');
    await expect(n10.term.getByText('to confirm').first()).toBeVisible({
      timeout: 10_000,
    });

    // 6. Type the branch name to confirm deletion
    await n10.term.type(branchName);
    await settleFor(
      n10.term.page,
      2_000,
      'the typed branch name to reach the confirm field before Enter'
    );
    await n10.term.press('Enter');

    // 7. Session disappears
    await expect(n10.term.getByText('(no sessions)')).toBeVisible({
      timeout: 15_000,
    });

    // 8. Worktree directory removed from disk
    expect(existsSync(worktreePath)).toBe(false);

    // 9. Local branch deleted
    let branchExists = true;
    try {
      execSync(`git rev-parse --verify "${branchName}"`, {
        cwd: n10.repoPath,
        stdio: 'pipe',
      });
    } catch {
      branchExists = false;
    }
    expect(branchExists).toBe(false);
  });
});

test.describe('Session Lifecycle – dirty worktree', () => {
  test('delete session with dirty worktree is force-removed', async ({
    n10,
  }) => {
    const branchName = 'e2e-dirty';
    const sessionName = branchName;

    // 1. Empty state
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();

    // 2. Create session via branch picker
    await n10.term.type('c');
    await expect(n10.term.getByText('Branch Picker')).toBeVisible();
    await n10.term.type(branchName);
    await expect(n10.term.getByText(/\(new branch\)/).first()).toBeVisible({
      timeout: 5_000,
    });
    await settleFor(
      n10.term.page,
      2_000,
      "Ink's useInput captured the old filter until the next render"
    );
    await n10.term.press('Enter');

    await expect(n10.term.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });
    await dismissSessionMenu(n10.term);
    await expect(n10.term.getByText(sessionName).first()).toBeVisible({
      timeout: 10_000,
    });

    // 3. Make the worktree dirty by writing an untracked file
    const worktreePath = join(
      n10.repoPath,
      '.claude',
      'worktrees',
      sessionName
    );
    expect(existsSync(worktreePath)).toBe(true);
    writeFileSync(join(worktreePath, 'dirty.txt'), 'uncommitted change');

    // 4. Press 'x' — canRemoveBranch detects uncommitted changes → confirm
    await n10.term.type('x');
    await expect(n10.term.getByText('to confirm').first()).toBeVisible({
      timeout: 10_000,
    });

    // 5. Confirm deletion by typing the branch name
    await n10.term.type(branchName);
    await settleFor(
      n10.term.page,
      2_000,
      'the typed branch name to reach the confirm field before Enter'
    );
    await n10.term.press('Enter');

    // 6. Session disappears
    await expect(n10.term.getByText('(no sessions)')).toBeVisible({
      timeout: 15_000,
    });

    // 7. Worktree removed despite dirty state
    expect(existsSync(worktreePath)).toBe(false);
  });
});
