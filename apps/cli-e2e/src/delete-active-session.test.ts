import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/kirby.js';

test.use({
  kirbyConfig: {
    aiCommand: 'echo kirby-session-active && sleep 300',
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
    kirby,
  }) => {
    const branchName = 'e2e-active-delete';

    // Without a remote, brand-new branches register as "not pushed to
    // upstream" and route through the type-branch modal — the wrong
    // path for this test. Push HEAD to a bare remote so the new
    // branch's tip is reachable from `--remotes`, which makes
    // canRemoveBranch return safe and lets the active-session check
    // be the only thing standing between a key press and deletion.
    const bareRemote = mkdtempSync(join(tmpdir(), 'kirby-e2e-bare-'));
    try {
      execSync('git init --bare', { cwd: bareRemote, stdio: 'pipe' });
      execSync(`git remote add origin "${bareRemote}"`, {
        cwd: kirby.repoPath,
        stdio: 'pipe',
      });
      execSync('git push origin HEAD:master', {
        cwd: kirby.repoPath,
        stdio: 'pipe',
      });

      await expect(kirby.term.getByText('(no sessions)')).toBeVisible();

      // Create the session via the branch picker.
      await kirby.term.type('c');
      await expect(kirby.term.getByText('Branch Picker')).toBeVisible();
      await kirby.term.type(branchName);
      await expect(kirby.term.getByText(/\(new branch\)/).first()).toBeVisible({
        timeout: 5_000,
      });
      // Let React re-render so useInput closure captures the updated filter.
      await kirby.term.page.waitForTimeout(2_000);
      await kirby.term.press('Enter');
      await expect(kirby.term.getByText('Branch Picker')).not.toBeVisible({
        timeout: 5_000,
      });
      await expect(kirby.term.getByText(branchName).first()).toBeVisible({
        timeout: 10_000,
      });

      // Tab spawns the PTY (focus-terminal auto-starts a session when
      // none exists). Wait for the agent's stdout marker to confirm the
      // PTY is alive, then exit back to the sidebar with Ctrl+Space
      // (\x00 — Tab is forwarded into the PTY when focused there).
      await kirby.term.press('Tab');
      await expect(
        kirby.term.getByText('kirby-session-active').first()
      ).toBeVisible({ timeout: 10_000 });
      await kirby.term.write('\x00');
      await expect(kirby.term.getByText('quit').first()).toBeVisible({
        timeout: 5_000,
      });

      // The actual assertion: pressing delete must open the Y/N confirm
      // modal because the PTY is still running, even though the branch
      // itself is git-clean and pushed.
      await kirby.term.type('x');
      await expect(kirby.term.getByText('Confirm Delete').first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        kirby.term.getByText(/session is active/i).first()
      ).toBeVisible();

      // Esc cancels — session must remain in the sidebar.
      await kirby.term.press('Escape');
      await expect(kirby.term.getByText('Confirm Delete')).not.toBeVisible({
        timeout: 5_000,
      });
      await expect(kirby.term.getByText(branchName).first()).toBeVisible();
    } finally {
      rmSync(bareRemote, { recursive: true, force: true });
    }
  });
});
