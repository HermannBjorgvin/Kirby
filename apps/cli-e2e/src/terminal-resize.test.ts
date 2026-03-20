import { test, expect } from '@microsoft/tui-test';
import { createTestRepo, registerCleanup } from './setup/git-repo.js';
import { resolve } from 'node:path';

const testDir = createTestRepo();
const mainJs = resolve('../cli/dist/main.js');
registerCleanup(testDir);

// The useTerminalDimensions hook debounces resize events by 500ms.
// Wait longer than that before asserting post-resize layout.
const DEBOUNCE_SETTLE_MS = 700;

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
    await expect(
      terminal.getByText('Kirby', { strict: false })
    ).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();

    // 2. Resize to a larger terminal and wait for debounce
    terminal.resize(140, 40);
    await new Promise((r) => setTimeout(r, DEBOUNCE_SETTLE_MS));

    // 3. Verify the app still renders correctly after resize
    await expect(
      terminal.getByText('Kirby', { strict: false })
    ).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();
    await expect(terminal.getByText('checkout branch')).toBeVisible();
  });

  test('layout reflows when terminal is resized smaller', async ({
    terminal,
  }) => {
    // 1. Verify initial render at 100x30
    await expect(
      terminal.getByText('Kirby', { strict: false })
    ).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();

    // 2. Resize to a smaller terminal and wait for debounce
    terminal.resize(70, 20);
    await new Promise((r) => setTimeout(r, DEBOUNCE_SETTLE_MS));

    // 3. Verify the app still renders correctly at smaller size
    await expect(
      terminal.getByText('Kirby', { strict: false })
    ).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();
  });

  test('debounce coalesces rapid resizes into single update', async ({
    terminal,
  }) => {
    await expect(
      terminal.getByText('Kirby', { strict: false })
    ).toBeVisible();

    // Simulate a drag-resize: several size changes in quick succession.
    // The 500ms debounce should discard intermediate sizes and only
    // apply the final one.
    terminal.resize(90, 25);
    terminal.resize(80, 22);
    terminal.resize(120, 35);
    terminal.resize(100, 30);
    await new Promise((r) => setTimeout(r, DEBOUNCE_SETTLE_MS));

    // App should settle and render correctly at the final size
    await expect(
      terminal.getByText('Kirby', { strict: false })
    ).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();
    await expect(terminal.getByText('checkout branch')).toBeVisible();
  });
});
