import { test, expect } from './fixtures/kirby.js';
import { createSession } from './setup/sessions.js';

// ── Default Preset (Normie) ────────────────────────────────────────

test.describe('Keybindings — Default (Normie) Preset', () => {
  test('default shows normie-style hints without j/k', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(kirby.term.getByText('navigate')).toBeVisible();
    await expect(kirby.term.getByText('j/k').first()).not.toBeVisible({
      timeout: 3_000,
    });
  });

  test('s opens settings in normie preset', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('s');
    await expect(kirby.term.getByText('Settings').first()).toBeVisible();
  });

  test('arrow keys navigate sidebar in normie preset', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    // Arrow down should work (no-op with empty sidebar, but should not error)
    await kirby.term.press('ArrowDown');
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
  });
});

// ── Settings Controls Entry ────────────────────────────────────────

test.describe('Keybindings — Settings Controls', () => {
  test('settings panel shows Controls field with Normie preset', async ({
    kirby,
  }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('s');
    await expect(kirby.term.getByText('Settings').first()).toBeVisible();
    await expect(kirby.term.getByText('Controls').first()).toBeVisible();
    await expect(kirby.term.getByText('Normie defaults').first()).toBeVisible();
  });

  test('Enter on Controls opens controls sub-screen', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('s');
    await expect(kirby.term.getByText('Controls').first()).toBeVisible();

    // Controls is the first field — Enter opens sub-screen
    await kirby.term.press('Enter');
    await expect(kirby.term.getByText('Sidebar').first()).toBeVisible();
    await expect(kirby.term.getByText('Navigate down').first()).toBeVisible();
  });

  test('Esc from controls sub-screen returns to settings', async ({
    kirby,
  }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('s');
    await expect(kirby.term.getByText('Controls').first()).toBeVisible();
    await kirby.term.press('Enter');
    await expect(kirby.term.getByText('Navigate down').first()).toBeVisible();

    await kirby.term.press('Escape');
    await expect(kirby.term.getByText('Settings').first()).toBeVisible();
    await expect(kirby.term.getByText('Controls').first()).toBeVisible();
  });
});

// ── Preset Switching ───────────────────────────────────────────────

test.describe('Keybindings — Preset Switching', () => {
  test('cycling to Vim Losers preset updates sidebar hints', async ({
    kirby,
  }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();

    await kirby.term.type('s');
    await expect(kirby.term.getByText('Normie defaults').first()).toBeVisible();

    // Controls is first field — cycle right to switch to Vim Losers
    await kirby.term.press('ArrowRight');
    await expect(kirby.term.getByText('Vim Losers').first()).toBeVisible();

    // Close settings
    await kirby.term.press('Escape');

    // Sidebar hints should show vim-style "j/k"
    await expect(kirby.term.getByText('j/k').first()).toBeVisible({
      timeout: 3_000,
    });
  });
});

// ── Vim Losers Preset ──────────────────────────────────────────────

test.describe('Keybindings — Vim Losers Preset', () => {
  test.use({ kirbyConfig: { keybindPreset: 'vim' } });

  test('vim preset shows j/k in hints', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(kirby.term.getByText('j/k').first()).toBeVisible();
  });

  test('s opens settings in vim preset', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('s');
    await expect(kirby.term.getByText('Settings').first()).toBeVisible();
    await expect(kirby.term.getByText('Vim Losers').first()).toBeVisible();
  });

  test('j/k navigate sidebar in vim preset', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('j');
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
  });
});

// ── Preset Persistence ─────────────────────────────────────────────

test.describe('Keybindings — Preset Persistence', () => {
  test.use({ kirbyConfig: { keybindPreset: 'vim' } });

  test('preset persists across app launch', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    // Since we pre-set vim in config.json, hints should show j/k
    await expect(kirby.term.getByText('j/k').first()).toBeVisible();
    await kirby.term.type('s');
    await expect(kirby.term.getByText('Vim Losers').first()).toBeVisible();
  });
});

// ── Per-Binding Customization ──────────────────────────────────────

test.describe('Keybindings — Per-Binding Rebind', () => {
  test.use({ rows: 40 });

  test('can navigate bindings and enter rebind mode', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();

    await kirby.term.type('s');
    await expect(kirby.term.getByText('Controls').first()).toBeVisible();

    await kirby.term.press('Enter');
    await expect(kirby.term.getByText('Navigate down').first()).toBeVisible();

    // First binding row should be selected (has › marker)
    await expect(kirby.term.getByText(/›.*↓/).first()).toBeVisible();

    // Navigate down to Quit binding
    await kirby.term.type('j');
    await kirby.term.type('j');
    await kirby.term.page.waitForTimeout(300);

    // Enter rebind mode
    await kirby.term.press('Enter');
    await expect(kirby.term.getByText('Press a key').first()).toBeVisible();
  });

  test('pressing a key rebinds the action', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();

    await kirby.term.type('s');
    await expect(kirby.term.getByText('Controls').first()).toBeVisible();
    await kirby.term.press('Enter');
    await expect(kirby.term.getByText('Navigate down').first()).toBeVisible();

    // Navigate to Quit action (3rd binding: Down, Up, Quit)
    await kirby.term.type('j');
    await kirby.term.type('j');
    await kirby.term.page.waitForTimeout(300);

    // Enter rebind mode
    await kirby.term.press('Enter');
    await expect(kirby.term.getByText('Press a key').first()).toBeVisible();

    // Press 'z' to rebind quit to z
    await kirby.term.type('z');
    await kirby.term.page.waitForTimeout(500);

    // Exit rebind mode, 'z' now shown as the new key
    await expect(kirby.term.getByText('z').first()).toBeVisible();
    // Binding marked as custom with *
    await expect(kirby.term.getByText('*').first()).toBeVisible();
  });

  test('Esc cancels rebind without changing', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();

    await kirby.term.type('s');
    await expect(kirby.term.getByText('Controls').first()).toBeVisible();
    await kirby.term.press('Enter');
    await expect(kirby.term.getByText('Navigate down').first()).toBeVisible();

    // Enter rebind mode on first binding
    await kirby.term.press('Enter');
    await expect(kirby.term.getByText('Press a key').first()).toBeVisible();

    // Esc to cancel
    await kirby.term.press('Escape');

    // No "Press a key" prompt; original binding still shown
    await expect(kirby.term.getByText('Press a key').first()).not.toBeVisible({
      timeout: 3_000,
    });
    await expect(kirby.term.getByText('↓').first()).toBeVisible();
  });
});

// ── Hint Toggle ────────────────────────────────────────────────────

test.describe('Keybindings — Hint Toggle', () => {
  // Default 30 rows leaves the last hint right at the bottom border; use
  // a taller terminal so the full expanded list is unambiguously visible.
  test.use({ rows: 40 });

  test('? collapses hints to single "show hints" row and restores them', async ({
    kirby,
  }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();

    // Default state: full hint list rendered, including the toggle itself.
    await expect(kirby.term.getByText('hide hints').first()).toBeVisible();
    await expect(kirby.term.getByText('quit').first()).toBeVisible();

    // Collapse.
    await kirby.term.type('?');
    await expect(kirby.term.getByText('show hints').first()).toBeVisible();
    await expect(kirby.term.getByText('quit').first()).not.toBeVisible({
      timeout: 3_000,
    });
    await expect(kirby.term.getByText('hide hints').first()).not.toBeVisible({
      timeout: 3_000,
    });

    // Restore.
    await kirby.term.type('?');
    await expect(kirby.term.getByText('hide hints').first()).toBeVisible();
    await expect(kirby.term.getByText('quit').first()).toBeVisible();
  });

  test('collapsed hints survive sidebar navigation', async ({ kirby }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();

    // Two sidebar items so j/k actually changes selection.
    await createSession(kirby.term, 'first');
    await createSession(kirby.term, 'second');

    // Collapse hints.
    await kirby.term.type('?');
    await expect(kirby.term.getByText('show hints').first()).toBeVisible();

    // Navigate the sidebar — used to remount MainTabBody and reset
    // hintsHidden, restoring the full hint list.
    await kirby.term.press('ArrowUp');
    await kirby.term.press('ArrowDown');

    // Hints should still be collapsed.
    await expect(kirby.term.getByText('show hints').first()).toBeVisible();
    await expect(kirby.term.getByText('hide hints').first()).not.toBeVisible({
      timeout: 3_000,
    });
    await expect(kirby.term.getByText('quit').first()).not.toBeVisible({
      timeout: 3_000,
    });
  });
});

// ── Modifier key display ───────────────────────────────────────────

test.describe('Keybindings — Modifier key display', () => {
  test('normie preset shows Shift+k for kill agent in sidebar hints', async ({
    kirby,
  }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    // Normie preset binds kill-agent to Shift+K, displayed as Shift+k
    await expect(kirby.term.getByText('Shift+k').first()).toBeVisible();
    await expect(kirby.term.getByText('kill agent').first()).toBeVisible();
  });
});
