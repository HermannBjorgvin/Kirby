import { test, expect } from './fixtures/kirby.js';

test.use({
  kirbyConfig: { keybindPreset: 'vim' },
});

test.describe('Keyboard Navigation', () => {
  test('s opens settings panel', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('s');
    await expect(kirby.term.getByText('Settings').first()).toBeVisible();
  });

  test('Esc closes settings panel', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('s');
    await expect(kirby.term.getByText('Settings').first()).toBeVisible();
    await kirby.term.press('Escape');
    await expect(kirby.term.getByText('checkout branch')).toBeVisible();
  });

  test('c opens branch picker', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('c');
    // Branch picker shows the default branch name in the sidebar area.
    await expect(kirby.term.getByText(/master|main/).first()).toBeVisible();
  });

  test('Esc closes branch picker', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('c');
    await expect(kirby.term.getByText(/master|main/).first()).toBeVisible();
    await kirby.term.press('Escape');
    await expect(kirby.term.getByText('checkout branch')).toBeVisible();
  });
});
