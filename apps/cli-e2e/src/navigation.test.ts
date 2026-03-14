import { test, expect } from '@microsoft/tui-test';
import { createTestRepo, cleanupTestRepo } from './setup/git-repo.js';
import { resolve } from 'node:path';

const testDir = createTestRepo();
const mainJs = resolve('../cli/dist/main.js');
process.on('exit', () => cleanupTestRepo(testDir));

test.use({
  program: { file: 'node', args: [mainJs, testDir] },
});

test.describe('Keyboard Navigation', () => {
  test('s opens settings panel', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby')).toBeVisible();
    terminal.write('s');
    await expect(
      terminal.getByText('Settings', { strict: false })
    ).toBeVisible();
  });

  test('Esc closes settings panel', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby')).toBeVisible();
    terminal.write('s');
    await expect(
      terminal.getByText('Settings', { strict: false })
    ).toBeVisible();
    terminal.keyEscape();
    await expect(
      terminal.getByText('Worktree Sessions', { strict: false })
    ).toBeVisible();
  });

  test('c opens branch picker', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby')).toBeVisible();
    terminal.write('c');
    // Branch picker shows in the sidebar area
    await expect(terminal.getByText(/master|main/g)).toBeVisible();
  });

  test('Esc closes branch picker', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby')).toBeVisible();
    terminal.write('c');
    await expect(terminal.getByText(/master|main/g)).toBeVisible();
    terminal.keyEscape();
    await expect(terminal.getByText('checkout branch')).toBeVisible();
  });
});
