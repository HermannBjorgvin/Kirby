import { test, expect } from '@microsoft/tui-test';
import { createTestRepo, registerCleanup } from './setup/git-repo.js';
import { resolve } from 'node:path';

const testDir = createTestRepo();
const mainJs = resolve('../cli/dist/main.js');

registerCleanup(testDir);

test.use({
  program: { file: 'node', args: [mainJs, testDir] },
});

test.describe('App Startup', () => {
  test('renders Kirby header', async ({ terminal }) => {
    await expect(
      terminal.getByText('Kirby', { strict: false })
    ).toBeVisible();
  });

  test('shows empty state when no worktrees', async ({ terminal }) => {
    await expect(terminal.getByText('(no sessions)')).toBeVisible();
  });

  test('shows keybind hints', async ({ terminal }) => {
    await expect(terminal.getByText('checkout branch')).toBeVisible();
    await expect(terminal.getByText('quit')).toBeVisible();
  });
});
