import { test, expect } from './fixtures/n10.js';
import { settleFor } from './setup/waits.js';

// The useTerminalDimensions hook debounces resize events by 500ms.
// Wait longer than that before asserting post-resize layout.
const DEBOUNCE_SETTLE_MS = 700;

test.describe('Terminal Resize', () => {
  test('layout reflows when terminal is resized larger', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();

    await n10.term.resize(140, 40);
    await settleFor(
      n10.term.page,
      DEBOUNCE_SETTLE_MS,
      'longer than the resize debounce, or the layout has not changed yet'
    );

    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();
    await expect(n10.term.getByText('checkout branch')).toBeVisible();
  });

  test('layout reflows when terminal is resized smaller', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();

    await n10.term.resize(70, 20);
    await settleFor(
      n10.term.page,
      DEBOUNCE_SETTLE_MS,
      'longer than the resize debounce, or the layout has not changed yet'
    );

    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();
  });

  test('debounce coalesces rapid resizes into single update', async ({
    n10,
  }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();

    // Simulate a drag-resize: several size changes in quick succession.
    // The 500ms debounce should discard intermediate sizes and only
    // apply the final one.
    await n10.term.resize(90, 25);
    await n10.term.resize(80, 22);
    await n10.term.resize(120, 35);
    await n10.term.resize(100, 30);
    await settleFor(
      n10.term.page,
      DEBOUNCE_SETTLE_MS,
      'longer than the resize debounce, or the layout has not changed yet'
    );

    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();
    await expect(n10.term.getByText('checkout branch')).toBeVisible();
  });
});
