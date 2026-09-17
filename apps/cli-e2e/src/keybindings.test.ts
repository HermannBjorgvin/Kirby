import { test, expect } from './fixtures/n10.js';
import { createSession } from './setup/sessions.js';
import { settleFor } from './setup/waits.js';

// ── Default Preset (Normie) ────────────────────────────────────────

test.describe('Keybindings — Default (Normie) Preset', () => {
  test('default shows normie-style hints without j/k', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('navigate')).toBeVisible();
    await expect(n10.term.getByText('j/k').first()).not.toBeVisible({
      timeout: 3_000,
    });
  });

  test('s opens settings in normie preset', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await n10.term.type('s');
    await expect(n10.term.getByText('Settings').first()).toBeVisible();
  });

  test('arrow keys navigate sidebar in normie preset', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    // Arrow down should work (no-op with empty sidebar, but should not error)
    await n10.term.press('ArrowDown');
    await expect(n10.term.getByText('n10').first()).toBeVisible();
  });
});

// ── Settings Controls Entry ────────────────────────────────────────

test.describe('Keybindings — Settings Controls', () => {
  test('settings panel shows Controls field with Normie preset', async ({
    n10,
  }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await n10.term.type('s');
    await expect(n10.term.getByText('Settings').first()).toBeVisible();
    await expect(n10.term.getByText('Controls').first()).toBeVisible();
    await expect(n10.term.getByText('Normie defaults').first()).toBeVisible();
  });

  test('Enter on Controls opens controls sub-screen', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await n10.term.type('s');
    await expect(n10.term.getByText('Controls').first()).toBeVisible();

    // Controls is the first field — Enter opens sub-screen
    await n10.term.press('Enter');
    await expect(n10.term.getByText('Sidebar').first()).toBeVisible();
    await expect(n10.term.getByText('Navigate down').first()).toBeVisible();
  });

  test('Esc from controls sub-screen returns to settings', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await n10.term.type('s');
    await expect(n10.term.getByText('Controls').first()).toBeVisible();
    await n10.term.press('Enter');
    await expect(n10.term.getByText('Navigate down').first()).toBeVisible();

    await n10.term.press('Escape');
    await expect(n10.term.getByText('Settings').first()).toBeVisible();
    await expect(n10.term.getByText('Controls').first()).toBeVisible();
  });
});

// ── Preset Switching ───────────────────────────────────────────────

test.describe('Keybindings — Preset Switching', () => {
  test('cycling to Vim Losers preset updates sidebar hints', async ({
    n10,
  }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();

    await n10.term.type('s');
    await expect(n10.term.getByText('Normie defaults').first()).toBeVisible();

    // Controls is first field — cycle right to switch to Vim Losers
    await n10.term.press('ArrowRight');
    await expect(n10.term.getByText('Vim Losers').first()).toBeVisible();

    // Close settings
    await n10.term.press('Escape');

    // Sidebar hints should show vim-style "j/k"
    await expect(n10.term.getByText('j/k').first()).toBeVisible({
      timeout: 3_000,
    });
  });
});

// ── Vim Losers Preset ──────────────────────────────────────────────

test.describe('Keybindings — Vim Losers Preset', () => {
  test.use({ n10Config: { keybindPreset: 'vim' } });

  test('vim preset shows j/k in hints', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('j/k').first()).toBeVisible();
  });

  test('s opens settings in vim preset', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await n10.term.type('s');
    await expect(n10.term.getByText('Settings').first()).toBeVisible();
    await expect(n10.term.getByText('Vim Losers').first()).toBeVisible();
  });

  test('j/k navigate sidebar in vim preset', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await n10.term.type('j');
    await expect(n10.term.getByText('n10').first()).toBeVisible();
  });
});

// ── Preset Persistence ─────────────────────────────────────────────

test.describe('Keybindings — Preset Persistence', () => {
  test.use({ n10Config: { keybindPreset: 'vim' } });

  test('preset persists across app launch', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    // Since we pre-set vim in config.json, hints should show j/k
    await expect(n10.term.getByText('j/k').first()).toBeVisible();
    await n10.term.type('s');
    await expect(n10.term.getByText('Vim Losers').first()).toBeVisible();
  });
});

// ── Per-Binding Customization ──────────────────────────────────────

test.describe('Keybindings — Per-Binding Rebind', () => {
  test.use({ rows: 40 });

  test('can navigate bindings and enter rebind mode', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();

    await n10.term.type('s');
    await expect(n10.term.getByText('Controls').first()).toBeVisible();

    await n10.term.press('Enter');
    await expect(n10.term.getByText('Navigate down').first()).toBeVisible();

    // First binding row should be selected (has › marker)
    await expect(n10.term.getByText(/›.*↓/).first()).toBeVisible();

    // Navigate down to Quit binding
    await n10.term.type('j');
    await n10.term.type('j');
    await settleFor(
      n10.term.page,
      300,
      'the sidebar selection to move before the next key'
    );

    // Enter rebind mode
    await n10.term.press('Enter');
    await expect(n10.term.getByText('Press a key').first()).toBeVisible();
  });

  test('pressing a key rebinds the action', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();

    await n10.term.type('s');
    await expect(n10.term.getByText('Controls').first()).toBeVisible();
    await n10.term.press('Enter');
    await expect(n10.term.getByText('Navigate down').first()).toBeVisible();

    // Navigate to Quit action (3rd binding: Down, Up, Quit)
    await n10.term.type('j');
    await n10.term.type('j');
    await settleFor(
      n10.term.page,
      300,
      'the sidebar selection to move before the next key'
    );

    // Enter rebind mode
    await n10.term.press('Enter');
    await expect(n10.term.getByText('Press a key').first()).toBeVisible();

    // Press 'z' to rebind quit to z
    await n10.term.type('z');

    // Exit rebind mode, 'z' now shown as the new key
    await expect(n10.term.getByText('z').first()).toBeVisible();
    // Binding marked as custom with *
    await expect(n10.term.getByText('*').first()).toBeVisible();
  });

  test('Esc cancels rebind without changing', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();

    await n10.term.type('s');
    await expect(n10.term.getByText('Controls').first()).toBeVisible();
    await n10.term.press('Enter');
    await expect(n10.term.getByText('Navigate down').first()).toBeVisible();

    // Enter rebind mode on first binding
    await n10.term.press('Enter');
    await expect(n10.term.getByText('Press a key').first()).toBeVisible();

    // Esc to cancel
    await n10.term.press('Escape');

    // No "Press a key" prompt; original binding still shown
    await expect(n10.term.getByText('Press a key').first()).not.toBeVisible({
      timeout: 3_000,
    });
    await expect(n10.term.getByText('↓').first()).toBeVisible();
  });
});

// ── Hint Toggle ────────────────────────────────────────────────────

test.describe('Keybindings — Hint Toggle', () => {
  // Default 30 rows leaves the last hint right at the bottom border; use
  // a taller terminal so the full expanded list is unambiguously visible.
  test.use({ rows: 40 });

  test('? collapses hints to single "show hints" row and restores them', async ({
    n10,
  }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();

    // Default state: full hint list rendered, including the toggle itself.
    await expect(n10.term.getByText('hide hints').first()).toBeVisible();
    await expect(n10.term.getByText('quit').first()).toBeVisible();

    // Collapse.
    await n10.term.type('?');
    await expect(n10.term.getByText('show hints').first()).toBeVisible();
    await expect(n10.term.getByText('quit').first()).not.toBeVisible({
      timeout: 3_000,
    });
    await expect(n10.term.getByText('hide hints').first()).not.toBeVisible({
      timeout: 3_000,
    });

    // Restore.
    await n10.term.type('?');
    await expect(n10.term.getByText('hide hints').first()).toBeVisible();
    await expect(n10.term.getByText('quit').first()).toBeVisible();
  });

  test('collapsed hints survive sidebar navigation', async ({ n10 }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();

    // Two sidebar items so j/k actually changes selection.
    await createSession(n10.term, 'first');
    await createSession(n10.term, 'second');

    // Collapse hints.
    await n10.term.type('?');
    await expect(n10.term.getByText('show hints').first()).toBeVisible();

    // Navigate the sidebar — used to remount MainTabBody and reset
    // hintsHidden, restoring the full hint list.
    await n10.term.press('ArrowUp');
    await n10.term.press('ArrowDown');

    // Hints should still be collapsed.
    await expect(n10.term.getByText('show hints').first()).toBeVisible();
    await expect(n10.term.getByText('hide hints').first()).not.toBeVisible({
      timeout: 3_000,
    });
    await expect(n10.term.getByText('quit').first()).not.toBeVisible({
      timeout: 3_000,
    });
  });
});

// ── Modifier key display ───────────────────────────────────────────

test.describe('Keybindings — Modifier key display', () => {
  test('normie preset shows Shift+k for kill agent in sidebar hints', async ({
    n10,
  }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    // Normie preset binds kill-agent to Shift+K, displayed as Shift+k
    await expect(n10.term.getByText('Shift+k').first()).toBeVisible();
    await expect(n10.term.getByText('kill agent').first()).toBeVisible();
  });
});
