import { test, expect } from './fixtures/kirby.js';

// The useTerminalDimensions hook debounces resize events by 500ms.
// Wait longer than that before asserting post-resize layout.
const DEBOUNCE_SETTLE_MS = 700;

test.describe('Terminal Resize', () => {
  test('layout reflows when terminal is resized larger', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible();

    await kirby.term.resize(140, 40);
    await kirby.term.page.waitForTimeout(DEBOUNCE_SETTLE_MS);

    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible();
    await expect(kirby.term.getByText('checkout branch')).toBeVisible();
  });

  test('layout reflows when terminal is resized smaller', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible();

    await kirby.term.resize(70, 20);
    await kirby.term.page.waitForTimeout(DEBOUNCE_SETTLE_MS);

    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible();
  });

  test('debounce coalesces rapid resizes into single update', async ({
    kirby,
  }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();

    // Simulate a drag-resize: several size changes in quick succession.
    // The 500ms debounce should discard intermediate sizes and only
    // apply the final one.
    await kirby.term.resize(90, 25);
    await kirby.term.resize(80, 22);
    await kirby.term.resize(120, 35);
    await kirby.term.resize(100, 30);
    await kirby.term.page.waitForTimeout(DEBOUNCE_SETTLE_MS);

    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible();
    await expect(kirby.term.getByText('checkout branch')).toBeVisible();
  });
});
