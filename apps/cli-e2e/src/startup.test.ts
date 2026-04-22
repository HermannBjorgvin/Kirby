import { test, expect } from './fixtures/kirby.js';

test.describe('App Startup', () => {
  test('renders Kirby header', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
  });

  test('shows empty state when no worktrees', async ({ kirby }) => {
    await expect(kirby.term.getByText('(no sessions)').first()).toBeVisible();
  });

  test('shows keybind hints', async ({ kirby }) => {
    await expect(kirby.term.getByText('checkout branch').first()).toBeVisible();
    await expect(kirby.term.getByText('quit').first()).toBeVisible();
  });
});
