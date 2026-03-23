import { test, expect } from '@microsoft/tui-test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestRepo, registerCleanup } from './setup/git-repo.js';

const testDir = createTestRepo();
const mainJs = resolve('../cli/dist/main.js');
registerCleanup(testDir);

// Isolated home so the default normie preset is used deterministically
const home = mkdtempSync(join(tmpdir(), 'kirby-startup-'));
registerCleanup(home);
mkdirSync(join(home, '.kirby'), { recursive: true });

test.use({
  program: { file: 'node', args: [mainJs, testDir] },
  env: {
    ...process.env,
    HOME: home,
    TERM: 'xterm-256color',
  },
});

test.describe('App Startup', () => {
  test('renders Kirby header', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
  });

  test('shows empty state when no worktrees', async ({ terminal }) => {
    await expect(terminal.getByText('(no sessions)')).toBeVisible();
  });

  test('shows keybind hints', async ({ terminal }) => {
    await expect(terminal.getByText('checkout branch')).toBeVisible();
    await expect(terminal.getByText('quit')).toBeVisible();
  });
});
