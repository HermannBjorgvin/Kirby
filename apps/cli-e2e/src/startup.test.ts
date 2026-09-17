import { test, expect } from './fixtures/n10.js';

test.describe('App Startup', () => {
  test('renders n10 header', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
  });

  test('shows empty state when no worktrees', async ({ n10 }) => {
    await expect(n10.term.getByText('(no sessions)').first()).toBeVisible();
  });

  test('shows keybind hints', async ({ n10 }) => {
    await expect(n10.term.getByText('checkout branch').first()).toBeVisible();
    await expect(n10.term.getByText('quit').first()).toBeVisible();
  });
});
