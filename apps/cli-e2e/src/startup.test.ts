import { test, expect } from '@microsoft/tui-test';
import { createTestRepo, cleanupTestRepo } from './setup/git-repo.js';
import { resolve } from 'node:path';

const testDir = createTestRepo();
const mainJs = resolve('../cli/dist/main.js');

// Cleanup on process exit (tui-test has no afterAll)
process.on('exit', () => cleanupTestRepo(testDir));

test.use({
  program: { file: 'node', args: [mainJs, testDir] },
});

test.describe('App Startup', () => {
  test('renders Kirby header', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby')).toBeVisible();
  });

  test('shows Sessions tab', async ({ terminal }) => {
    await expect(terminal.getByText('1 Sessions')).toBeVisible();
  });

  test('shows sidebar title', async ({ terminal }) => {
    await expect(
      terminal.getByText('Worktree Sessions', { strict: false })
    ).toBeVisible();
  });

  test('shows empty state when no worktrees', async ({ terminal }) => {
    await expect(terminal.getByText('(no sessions)')).toBeVisible();
  });

  test('shows keybind hints', async ({ terminal }) => {
    await expect(terminal.getByText('checkout branch')).toBeVisible();
    await expect(terminal.getByText('quit')).toBeVisible();
  });

  test('does not show Reviews tab without VCS config', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby')).toBeVisible();
    await expect(terminal.getByText('2 Reviews')).not.toBeVisible();
  });
});
