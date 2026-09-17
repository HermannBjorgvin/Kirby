import { test, expect } from './fixtures/n10.js';

test.use({
  n10Config: { keybindPreset: 'vim' },
});

test.describe('Keyboard Navigation', () => {
  test('s opens settings panel', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await n10.term.type('s');
    await expect(n10.term.getByText('Settings').first()).toBeVisible();
  });

  test('Esc closes settings panel', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await n10.term.type('s');
    await expect(n10.term.getByText('Settings').first()).toBeVisible();
    await n10.term.press('Escape');
    await expect(n10.term.getByText('checkout branch')).toBeVisible();
  });

  test('c opens branch picker', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await n10.term.type('c');
    // Branch picker shows the default branch name in the sidebar area.
    await expect(n10.term.getByText(/master|main/).first()).toBeVisible();
  });

  test('Esc closes branch picker', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await n10.term.type('c');
    await expect(n10.term.getByText(/master|main/).first()).toBeVisible();
    await n10.term.press('Escape');
    await expect(n10.term.getByText('checkout branch')).toBeVisible();
  });
});
