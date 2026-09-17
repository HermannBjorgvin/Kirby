import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import { startFromSessionMenu } from './setup/sessions.js';
import { settleFor } from './setup/waits.js';

test.use({
  n10Config: {
    aiCommand: 'echo n10-session-active && sleep 300',
    keybindPreset: 'vim',
  },
});

// Pins the safety contract added in sidebar-input.ts: when the agent's
// PTY is alive, pressing delete on the session must open the Y/N
// confirm modal, NOT silently kill the session. Regressing this check
// is a data-loss bug (in-memory plan/context lost), so it earns a
// dedicated e2e.
test.describe('Delete active session', () => {
  test('git-clean session with live PTY requires confirmation', async ({
    n10,
  }) => {
    const branchName = 'e2e-active-delete';

    // Without a remote, brand-new branches register as "not pushed to
    // upstream" and route through the type-branch modal — the wrong
    // path for this test. Push HEAD to a bare remote so the new
    // branch's tip is reachable from `--remotes`, which makes
    // canRemoveBranch return safe and lets the active-session check
    // be the only thing standing between a key press and deletion.
    const bareRemote = mkdtempSync(join(tmpdir(), 'n10-e2e-bare-'));
    try {
      execSync('git init --bare', { cwd: bareRemote, stdio: 'pipe' });
      execSync(`git remote add origin "${bareRemote}"`, {
        cwd: n10.repoPath,
        stdio: 'pipe',
      });
      execSync('git push origin HEAD:master', {
        cwd: n10.repoPath,
        stdio: 'pipe',
      });

      await expect(n10.term.getByText('(no sessions)')).toBeVisible();

      // Create the session via the branch picker.
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
      await expect(n10.term.getByText('Branch Picker')).not.toBeVisible({
        timeout: 5_000,
      });
      await expect(n10.term.getByText(branchName).first()).toBeVisible({
        timeout: 10_000,
      });

      // Worktree creation lands in the session menu; Enter starts the
      // PTY. Wait for the agent's stdout marker to confirm the PTY is
      // alive, then exit back to the sidebar with Ctrl+Space (\x00 —
      // Tab is forwarded into the PTY when focused there).
      await startFromSessionMenu(n10.term);
      await expect(
        n10.term.getByText('n10-session-active').first()
      ).toBeVisible({ timeout: 10_000 });
      await n10.term.write('\x00');
      await expect(n10.term.getByText('quit').first()).toBeVisible({
        timeout: 5_000,
      });

      // The actual assertion: pressing delete must open the Y/N confirm
      // modal because the PTY is still running, even though the branch
      // itself is git-clean and pushed.
      //
      // The press is retried because returning from the terminal to the
      // sidebar is not instantaneous and the hint row above is on
      // screen either way, so it is no signal that focus has landed —
      // a keystroke sent into that gap goes to the PTY and is simply
      // lost, with nothing left to wait for. Observed as an occasional
      // CI failure that does not reproduce on a developer machine.
      // Repeating is harmless: the modal itself only answers y/n/Esc.
      await expect(async () => {
        await n10.term.type('x');
        await expect(n10.term.getByText('Confirm Delete').first()).toBeVisible({
          timeout: 3_000,
        });
      }).toPass({ timeout: 20_000 });
      await expect(
        n10.term.getByText(/session is active/i).first()
      ).toBeVisible();

      // Esc cancels — session must remain in the sidebar.
      await n10.term.press('Escape');
      await expect(n10.term.getByText('Confirm Delete')).not.toBeVisible({
        timeout: 5_000,
      });
      await expect(n10.term.getByText(branchName).first()).toBeVisible();
    } finally {
      rmSync(bareRemote, { recursive: true, force: true });
    }
  });
});
