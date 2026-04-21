import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/kirby.js';

test.use({
  kirbyConfig: {
    aiCommand: 'echo kirby-session-active && sleep 300',
    keybindPreset: 'vim',
  },
});

test.describe('Session Lifecycle – clean delete', () => {
  test('create session via branch picker, then delete with confirmation', async ({
    kirby,
  }) => {
    const branchName = 'e2e-lifecycle';
    const sessionName = branchName;

    // 1. Empty state
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible();

    // 2. Open branch picker, type a new branch name
    await kirby.term.type('c');
    await expect(kirby.term.getByText('Branch Picker')).toBeVisible();
    await kirby.term.type(branchName);
    await expect(kirby.term.getByText(/\(new branch\)/).first()).toBeVisible({
      timeout: 5_000,
    });

    // Let React re-render so useInput closure captures the updated filter.
    await kirby.term.page.waitForTimeout(2_000);
    await kirby.term.press('Enter');

    // 3. Branch picker closes, session appears in sidebar
    await expect(kirby.term.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(kirby.term.getByText(sessionName).first()).toBeVisible({
      timeout: 10_000,
    });

    // 4. Worktree directory was created on disk
    const worktreePath = join(
      kirby.repoPath,
      '.claude',
      'worktrees',
      sessionName
    );
    expect(existsSync(worktreePath)).toBe(true);

    // 5. Press 'x' to delete — no remote tracking, so a confirm dialog
    //    appears. The confirm text wraps in a 100-col terminal, so match
    //    a short fragment that stays on one line.
    await kirby.term.type('x');
    await expect(kirby.term.getByText('to confirm').first()).toBeVisible({
      timeout: 10_000,
    });

    // 6. Type the branch name to confirm deletion
    await kirby.term.type(branchName);
    await kirby.term.page.waitForTimeout(2_000);
    await kirby.term.press('Enter');

    // 7. Session disappears
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible({
      timeout: 15_000,
    });

    // 8. Worktree directory removed from disk
    expect(existsSync(worktreePath)).toBe(false);

    // 9. Local branch deleted
    let branchExists = true;
    try {
      execSync(`git rev-parse --verify "${branchName}"`, {
        cwd: kirby.repoPath,
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
    kirby,
  }) => {
    const branchName = 'e2e-dirty';
    const sessionName = branchName;

    // 1. Empty state
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible();

    // 2. Create session via branch picker
    await kirby.term.type('c');
    await expect(kirby.term.getByText('Branch Picker')).toBeVisible();
    await kirby.term.type(branchName);
    await expect(kirby.term.getByText(/\(new branch\)/).first()).toBeVisible({
      timeout: 5_000,
    });
    await kirby.term.page.waitForTimeout(2_000);
    await kirby.term.press('Enter');

    await expect(kirby.term.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(kirby.term.getByText(sessionName).first()).toBeVisible({
      timeout: 10_000,
    });

    // 3. Make the worktree dirty by writing an untracked file
    const worktreePath = join(
      kirby.repoPath,
      '.claude',
      'worktrees',
      sessionName
    );
    expect(existsSync(worktreePath)).toBe(true);
    writeFileSync(join(worktreePath, 'dirty.txt'), 'uncommitted change');

    // 4. Press 'x' — canRemoveBranch detects uncommitted changes → confirm
    await kirby.term.type('x');
    await expect(kirby.term.getByText('to confirm').first()).toBeVisible({
      timeout: 10_000,
    });

    // 5. Confirm deletion by typing the branch name
    await kirby.term.type(branchName);
    await kirby.term.page.waitForTimeout(2_000);
    await kirby.term.press('Enter');

    // 6. Session disappears
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible({
      timeout: 15_000,
    });

    // 7. Worktree removed despite dirty state
    expect(existsSync(worktreePath)).toBe(false);
  });
});
