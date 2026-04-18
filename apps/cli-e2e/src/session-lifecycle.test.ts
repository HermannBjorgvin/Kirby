import { test, expect } from '@microsoft/tui-test';
import { writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import {
  MAIN_JS,
  createIsolatedTestEnv,
  deleteSelectedSession,
  openBranchPickerAndCreate,
} from './setup/app.js';

// ── Test 1: Clean session lifecycle ────────────────────────────────

const env1 = createIsolatedTestEnv({
  scope: 'lifecycle',
  config: {
    aiCommand: 'echo kirby-session-active && sleep 300',
    keybindPreset: 'vim',
  },
});

test.describe('Session Lifecycle – clean delete', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, env1.dir] },
    env: {
      ...process.env,
      HOME: env1.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: env1.log,
    },
  });

  test('create session via branch picker, then delete with confirmation', async ({
    terminal,
  }) => {
    const branchName = 'e2e-lifecycle';
    const sessionName = branchName;

    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();

    await openBranchPickerAndCreate(terminal, branchName);

    // Verify worktree directory was created on disk
    const worktreePath = join(env1.dir, '.claude', 'worktrees', sessionName);
    expect(existsSync(worktreePath)).toBe(true);

    await deleteSelectedSession(terminal, branchName);

    // Verify worktree directory was removed from disk
    expect(existsSync(worktreePath)).toBe(false);

    // Verify local branch was deleted
    let branchExists = true;
    try {
      execSync(`git rev-parse --verify "${branchName}"`, {
        cwd: env1.dir,
        stdio: 'pipe',
      });
    } catch {
      branchExists = false;
    }
    expect(branchExists).toBe(false);
  });
});

// ── Test 2: Dirty worktree deletion ────────────────────────────────

const env2 = createIsolatedTestEnv({
  scope: 'lifecycle',
  config: {
    aiCommand: 'echo kirby-session-active && sleep 300',
    keybindPreset: 'vim',
  },
});

test.describe('Session Lifecycle – dirty worktree', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, env2.dir] },
    env: {
      ...process.env,
      HOME: env2.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: env2.log,
    },
  });

  test('delete session with dirty worktree is force-removed', async ({
    terminal,
  }) => {
    const branchName = 'e2e-dirty';
    const sessionName = branchName;

    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();

    await openBranchPickerAndCreate(terminal, branchName);

    // Make the worktree dirty by writing an untracked file
    const worktreePath = join(env2.dir, '.claude', 'worktrees', sessionName);
    expect(existsSync(worktreePath)).toBe(true);
    writeFileSync(join(worktreePath, 'dirty.txt'), 'uncommitted change');

    // canRemoveBranch detects uncommitted changes → confirm dialog still works
    await deleteSelectedSession(terminal, branchName);

    // Verify worktree directory was fully removed despite dirty state
    expect(existsSync(worktreePath)).toBe(false);
  });
});
