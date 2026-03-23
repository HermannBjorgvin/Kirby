import { test, expect } from '@microsoft/tui-test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestRepo, registerCleanup } from './setup/git-repo.js';

// ── Helpers ────────────────────────────────────────────────────────

function createIsolatedTestEnv() {
  const dir = createTestRepo();
  const home = mkdtempSync(join(tmpdir(), 'kirby-lifecycle-home-'));
  const log = join(tmpdir(), `kirby-lifecycle-${Date.now()}.log`);
  registerCleanup(dir);
  registerCleanup(home);

  const kd = join(home, '.kirby');
  mkdirSync(kd, { recursive: true });
  writeFileSync(
    join(kd, 'config.json'),
    JSON.stringify({
      aiCommand: 'echo kirby-session-active && sleep 300',
      keybindPreset: 'vim',
    }),
    'utf-8'
  );

  return { dir, home, log };
}

// Type text one character at a time so Ink's useInput processes each individually.
async function typeText(
  terminal: { write: (s: string) => void },
  text: string
) {
  for (const ch of text) {
    terminal.write(ch);
    await new Promise((r) => setTimeout(r, 80));
  }
}

const mainJs = resolve('../cli/dist/main.js');

// ── Test 1: Clean session lifecycle ────────────────────────────────

const env1 = createIsolatedTestEnv();

test.describe('Session Lifecycle – clean delete', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [mainJs, env1.dir] },
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

    // 1. Wait for empty state
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();

    // 2. Open branch picker, type a new branch name
    terminal.write('c');
    await expect(terminal.getByText('Branch Picker')).toBeVisible();

    await typeText(terminal, branchName);
    await expect(
      terminal.getByText('(new branch)', { strict: false })
    ).toBeVisible({ timeout: 5_000 });

    // Let React re-render so useInput closure captures the updated branchFilter
    await new Promise((r) => setTimeout(r, 2_000));
    terminal.write('\r');

    // 3. Wait for branch picker to close, then session to appear
    await expect(terminal.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(
      terminal.getByText(sessionName, { strict: false })
    ).toBeVisible({ timeout: 10_000 });

    // 4. Verify worktree directory was created on disk
    const worktreePath = join(env1.dir, '.claude', 'worktrees', sessionName);
    expect(existsSync(worktreePath)).toBe(true);

    // 5. Press 'x' to delete — no remote tracking → confirm dialog.
    //    The confirm text wraps across lines in a 100-col terminal,
    //    so match a short fragment that stays on one line.
    terminal.write('x');
    await expect(
      terminal.getByText('to confirm', { strict: false })
    ).toBeVisible({ timeout: 10_000 });

    // 6. Type the branch name to confirm deletion
    await typeText(terminal, branchName);
    await new Promise((r) => setTimeout(r, 2_000));
    terminal.write('\r');

    // 7. Session should disappear
    await expect(terminal.getByText('(no sessions)')).toBeVisible({
      timeout: 15_000,
    });

    // 8. Verify worktree directory was removed from disk
    expect(existsSync(worktreePath)).toBe(false);

    // 9. Verify local branch was deleted
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

const env2 = createIsolatedTestEnv();

test.describe('Session Lifecycle – dirty worktree', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [mainJs, env2.dir] },
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

    // 1. Wait for empty state
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();

    // 2. Create session via branch picker
    terminal.write('c');
    await expect(terminal.getByText('Branch Picker')).toBeVisible();

    await typeText(terminal, branchName);
    await expect(
      terminal.getByText('(new branch)', { strict: false })
    ).toBeVisible({ timeout: 5_000 });

    await new Promise((r) => setTimeout(r, 2_000));
    terminal.write('\r');

    await expect(terminal.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(
      terminal.getByText(sessionName, { strict: false })
    ).toBeVisible({ timeout: 10_000 });

    // 3. Make the worktree dirty by writing an untracked file
    const worktreePath = join(env2.dir, '.claude', 'worktrees', sessionName);
    expect(existsSync(worktreePath)).toBe(true);
    writeFileSync(join(worktreePath, 'dirty.txt'), 'uncommitted change');

    // 4. Press 'x' — canRemoveBranch detects uncommitted changes → confirm
    terminal.write('x');
    await expect(
      terminal.getByText('to confirm', { strict: false })
    ).toBeVisible({ timeout: 10_000 });

    // 5. Confirm deletion by typing the branch name
    await typeText(terminal, branchName);
    await new Promise((r) => setTimeout(r, 2_000));
    terminal.write('\r');

    // 6. Session should disappear
    await expect(terminal.getByText('(no sessions)')).toBeVisible({
      timeout: 15_000,
    });

    // 7. Verify worktree directory was fully removed despite dirty state
    expect(existsSync(worktreePath)).toBe(false);
  });
});
