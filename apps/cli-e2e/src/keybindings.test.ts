import { test, expect } from '@microsoft/tui-test';
import { MAIN_JS, createIsolatedTestEnv } from './setup/app.js';

// ── Default Preset (Normie) ────────────────────────────────────────

test.describe('Keybindings — Default (Normie) Preset', () => {
  const env = createIsolatedTestEnv({ scope: 'keybinds', config: 'normie' });

  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, env.dir] },
    env: {
      ...process.env,
      HOME: env.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: env.log,
    },
  });

  test('default shows normie-style hints without j/k', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    // Normie preset should show arrow key names, not j/k
    await expect(terminal.getByText('navigate')).toBeVisible();
    // Should NOT show "j/k" in the hints
    await expect(terminal.getByText('j/k', { strict: false })).not.toBeVisible({
      timeout: 3_000,
    });
  });

  test('s opens settings in normie preset', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    terminal.write('s');
    await expect(
      terminal.getByText('Settings', { strict: false })
    ).toBeVisible();
  });

  test('arrow keys navigate sidebar in normie preset', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    // Arrow down should work for navigation (no-op with empty sidebar, but should not error)
    terminal.keyDown();
    // App should still be responsive — verify main UI is present
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
  });
});

// ── Settings Controls Entry ────────────────────────────────────────

test.describe('Keybindings — Settings Controls', () => {
  const env = createIsolatedTestEnv({ scope: 'keybinds', config: 'normie' });

  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, env.dir] },
    env: {
      ...process.env,
      HOME: env.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: env.log,
    },
  });

  test('settings panel shows Controls field with Normie preset', async ({
    terminal,
  }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    // Open settings (normie uses s)
    terminal.write('s');
    await expect(
      terminal.getByText('Settings', { strict: false })
    ).toBeVisible();
    await expect(
      terminal.getByText('Controls', { strict: false })
    ).toBeVisible();
    await expect(
      terminal.getByText('Normie defaults', { strict: false })
    ).toBeVisible();
  });

  test('Enter on Controls opens controls sub-screen', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    // Open settings
    terminal.write('s');
    await expect(
      terminal.getByText('Controls', { strict: false })
    ).toBeVisible();

    // Controls should be the first field — press Enter to open sub-screen
    terminal.write('\r');
    await expect(
      terminal.getByText('Sidebar', { strict: false })
    ).toBeVisible();
    await expect(
      terminal.getByText('Navigate down', { strict: false })
    ).toBeVisible();
  });

  test('Esc from controls sub-screen returns to settings', async ({
    terminal,
  }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    terminal.write('s');
    await expect(
      terminal.getByText('Controls', { strict: false })
    ).toBeVisible();
    terminal.write('\r');
    await expect(
      terminal.getByText('Navigate down', { strict: false })
    ).toBeVisible();

    // Esc should return to settings
    terminal.keyEscape();
    await expect(
      terminal.getByText('Settings', { strict: false })
    ).toBeVisible();
    // Controls field should still be visible in the settings list
    await expect(
      terminal.getByText('Controls', { strict: false })
    ).toBeVisible();
  });
});

// ── Preset Switching ───────────────────────────────────────────────

test.describe('Keybindings — Preset Switching', () => {
  const env = createIsolatedTestEnv({ scope: 'keybinds', config: 'normie' });

  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, env.dir] },
    env: {
      ...process.env,
      HOME: env.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: env.log,
    },
  });

  test('cycling to Vim Losers preset updates sidebar hints', async ({
    terminal,
  }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();

    // Open settings (normie: s)
    terminal.write('s');
    await expect(
      terminal.getByText('Normie defaults', { strict: false })
    ).toBeVisible();

    // Controls is first field — cycle right to switch to Vim Losers
    terminal.keyRight();
    await expect(
      terminal.getByText('Vim Losers', { strict: false })
    ).toBeVisible();

    // Close settings
    terminal.keyEscape();

    // Now sidebar hints should show vim-style "j/k"
    await expect(terminal.getByText('j/k', { strict: false })).toBeVisible({
      timeout: 3_000,
    });
  });
});

// ── Vim Losers Preset ──────────────────────────────────────────────

test.describe('Keybindings — Vim Losers Preset', () => {
  const env = createIsolatedTestEnv({ scope: 'keybinds', config: 'vim' });

  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, env.dir] },
    env: {
      ...process.env,
      HOME: env.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: env.log,
    },
  });

  test('vim preset shows j/k in hints', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    await expect(terminal.getByText('j/k', { strict: false })).toBeVisible();
  });

  test('s opens settings in vim preset', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    terminal.write('s');
    await expect(
      terminal.getByText('Settings', { strict: false })
    ).toBeVisible();
    await expect(
      terminal.getByText('Vim Losers', { strict: false })
    ).toBeVisible();
  });

  test('j/k navigate sidebar in vim preset', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    // j should work for navigation (no-op with empty sidebar, but no error)
    terminal.write('j');
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
  });
});

// ── Preset Persistence ─────────────────────────────────────────────

test.describe('Keybindings — Preset Persistence', () => {
  // Pre-configure vim preset in config
  const env = createIsolatedTestEnv({ scope: 'keybinds', config: 'vim' });

  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, env.dir] },
    env: {
      ...process.env,
      HOME: env.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: env.log,
    },
  });

  test('preset persists across app launch', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    // Since we pre-set vim in config.json, hints should show j/k
    await expect(terminal.getByText('j/k', { strict: false })).toBeVisible();
    // And settings should show Vim Losers
    terminal.write('s');
    await expect(
      terminal.getByText('Vim Losers', { strict: false })
    ).toBeVisible();
  });
});

// ── Per-Binding Customization ──────────────────────────────────────

test.describe('Keybindings — Per-Binding Rebind', () => {
  const env = createIsolatedTestEnv({ scope: 'keybinds', config: 'normie' });

  test.use({
    rows: 40,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, env.dir] },
    env: {
      ...process.env,
      HOME: env.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: env.log,
    },
  });

  test('can navigate bindings and enter rebind mode', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();

    // Open settings (normie: s)
    terminal.write('s');
    await expect(
      terminal.getByText('Controls', { strict: false })
    ).toBeVisible();

    // Enter controls sub-screen
    terminal.write('\r');
    await expect(
      terminal.getByText('Navigate down', { strict: false })
    ).toBeVisible();

    // First binding row should be selected (has › marker)
    await expect(terminal.getByText(/›.*↓/g, { strict: false })).toBeVisible();

    // Navigate down to Quit binding
    terminal.write('j');
    terminal.write('j');
    await new Promise((r) => setTimeout(r, 300));

    // Press Enter to rebind
    terminal.write('\r');
    await expect(
      terminal.getByText('Press a key', { strict: false })
    ).toBeVisible();
  });

  test('pressing a key rebinds the action', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();

    // Open controls sub-screen
    terminal.write('s');
    await expect(
      terminal.getByText('Controls', { strict: false })
    ).toBeVisible();
    terminal.write('\r');
    await expect(
      terminal.getByText('Navigate down', { strict: false })
    ).toBeVisible();

    // Navigate to Quit action (3rd binding: Down, Up, Quit)
    terminal.write('j');
    terminal.write('j');
    await new Promise((r) => setTimeout(r, 300));

    // Enter rebind mode
    terminal.write('\r');
    await expect(
      terminal.getByText('Press a key', { strict: false })
    ).toBeVisible();

    // Press 'z' to rebind quit to z
    terminal.write('z');
    await new Promise((r) => setTimeout(r, 500));

    // Should exit rebind mode and show 'z' as the new key
    await expect(terminal.getByText('z', { strict: false })).toBeVisible();
    // The binding should be marked as custom with *
    await expect(terminal.getByText('*', { strict: false })).toBeVisible();
  });

  test('Esc cancels rebind without changing', async ({ terminal }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();

    // Open controls sub-screen
    terminal.write('s');
    await expect(
      terminal.getByText('Controls', { strict: false })
    ).toBeVisible();
    terminal.write('\r');
    await expect(
      terminal.getByText('Navigate down', { strict: false })
    ).toBeVisible();

    // Enter rebind mode on first binding
    terminal.write('\r');
    await expect(
      terminal.getByText('Press a key', { strict: false })
    ).toBeVisible();

    // Esc to cancel
    terminal.keyEscape();

    // Should return to normal controls view, no "Press a key" prompt
    await expect(
      terminal.getByText('Press a key', { strict: false })
    ).not.toBeVisible({ timeout: 3_000 });
    // Original binding still shown
    await expect(terminal.getByText('↓', { strict: false })).toBeVisible();
  });
});

// ── Modifier key display ───────────────────────────────────────────

test.describe('Keybindings — Modifier key display', () => {
  const env = createIsolatedTestEnv({ scope: 'keybinds', config: 'normie' });

  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, env.dir] },
    env: {
      ...process.env,
      HOME: env.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: env.log,
    },
  });

  test('normie preset shows Shift+k for kill agent in sidebar hints', async ({
    terminal,
  }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    // Normie preset binds kill-agent to Shift+K, displayed as Shift+k
    await expect(
      terminal.getByText('Shift+k', { strict: false })
    ).toBeVisible();
    await expect(
      terminal.getByText('kill agent', { strict: false })
    ).toBeVisible();
  });
});
