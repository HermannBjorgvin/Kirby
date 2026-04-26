import { expect, type KirbyTerm } from '../fixtures/kirby.js';

/**
 * Create a session via the branch picker. After this returns, the
 * session row is visible in the sidebar with the user still focused on
 * the sidebar (the PTY has NOT been started yet — use Tab to start +
 * focus the terminal).
 */
export async function createSession(
  term: KirbyTerm,
  branchName: string
): Promise<void> {
  await term.type('c');
  await expect(term.getByText('Branch Picker')).toBeVisible();
  await term.type(branchName);
  await expect(term.getByText(/\(new branch\)/).first()).toBeVisible({
    timeout: 5_000,
  });
  // Let React re-render so useInput closure captures the updated filter.
  await term.page.waitForTimeout(2_000);
  await term.press('Enter');
  await expect(term.getByText('Branch Picker')).not.toBeVisible({
    timeout: 5_000,
  });
  await expect(term.getByText(branchName).first()).toBeVisible({
    timeout: 10_000,
  });
}
