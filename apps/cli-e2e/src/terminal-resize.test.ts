import { test, expect } from '@microsoft/tui-test';
import { createTestRepo, registerCleanup } from './setup/git-repo.js';
import { resolve } from 'node:path';

const testDir = createTestRepo();
const mainJs = resolve('../cli/dist/main.js');
registerCleanup(testDir);

test.use({
  rows: 30,
  columns: 100,
  program: { file: 'node', args: [mainJs, testDir] },
});

test.describe('Terminal Resize', () => {
  test('layout reflows when terminal is resized larger', async ({
    terminal,
  }) => {
    // 1. Verify initial render at 100x30
    await expect(terminal.getByText('Kirby')).toBeVisible();
    await expect(terminal.getByText('1 Sessions')).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();

    // 2. Resize to a larger terminal
    terminal.resize(140, 40);

    // 3. Verify the app still renders correctly after resize
    await expect(terminal.getByText('Kirby')).toBeVisible();
    await expect(terminal.getByText('1 Sessions')).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();
    await expect(terminal.getByText('checkout branch')).toBeVisible();
  });

  test('layout reflows when terminal is resized smaller', async ({
    terminal,
  }) => {
    // 1. Verify initial render at 100x30
    await expect(terminal.getByText('Kirby')).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();

    // 2. Resize to a smaller terminal
    terminal.resize(70, 20);

    // 3. Verify the app still renders correctly at smaller size
    await expect(terminal.getByText('Kirby')).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();
  });

  test('layout survives multiple rapid resizes', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby')).toBeVisible();

    // Simulate a drag-resize: several size changes in quick succession
    terminal.resize(90, 25);
    terminal.resize(80, 22);
    terminal.resize(120, 35);
    terminal.resize(100, 30);

    // App should settle and render correctly at the final size
    await expect(terminal.getByText('Kirby')).toBeVisible();
    await expect(terminal.getByText('1 Sessions')).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();
    await expect(terminal.getByText('checkout branch')).toBeVisible();
  });
});
