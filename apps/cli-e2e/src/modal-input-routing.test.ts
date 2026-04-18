import { test, expect } from '@microsoft/tui-test';
import {
  MAIN_JS,
  createIsolatedTestEnv,
  openBranchPickerAndCreate,
  openSettings,
  typeText,
} from './setup/app.js';

// Covers the Phase 4 refactor where each modal owns its
// useInput({ isActive }) instead of MainTab routing everything. The
// risk profile is "a sidebar-bound key fires while a modal is open".
// Each describe uses a fresh env so one test's lingering raw-mode
// state can't contaminate another.

// ── T1: Settings absorbs sidebar-bound keys ──────────────────────

const envT1 = createIsolatedTestEnv({ scope: 'modal-routing-settings' });

test.describe('Modal input routing — settings absorbs keypresses', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, envT1.dir] },
    env: {
      ...process.env,
      HOME: envT1.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: envT1.log,
    },
  });

  test('pressing sidebar keybinds while settings is open does not open other modals', async ({
    terminal,
  }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();

    await openSettings(terminal);

    // 'c' is the sidebar "checkout branch" key. If input routing leaks
    // back to the sidebar handler, the branch picker will open on top
    // of (or replace) settings. With the Phase 4 refactor, settings's
    // own useInput absorbs the keypress and MainTab's early-return on
    // settingsOpen prevents double-routing.
    terminal.write('c');
    await new Promise((r) => setTimeout(r, 300));
    await expect(terminal.getByText('Branch Picker')).not.toBeVisible({
      timeout: 2_000,
    });
    // Settings must remain the visible pane title.
    await expect(
      terminal.getByText('Settings', { strict: false })
    ).toBeVisible();

    // Closing with Esc returns to sidebar, and the sidebar hint
    // ('quit') reappears — proving raw-mode and input routing both
    // recovered cleanly.
    terminal.keyEscape();
    await expect(terminal.getByText('quit', { strict: false })).toBeVisible({
      timeout: 5_000,
    });
  });
});

// ── T2: Branch picker Esc returns to sidebar cleanly ──────────────

const envT2 = createIsolatedTestEnv({ scope: 'modal-routing-picker' });

test.describe('Modal input routing — branch picker Esc recovery', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, envT2.dir] },
    env: {
      ...process.env,
      HOME: envT2.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: envT2.log,
    },
  });

  test('Esc from branch picker restores sidebar input without bleed-through', async ({
    terminal,
  }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();

    // Open the branch picker and type a partial filter.
    terminal.write('c');
    await expect(terminal.getByText('Branch Picker')).toBeVisible();
    await typeText(terminal, 'abc');

    // Esc closes the picker. The picker's useInput detaches via
    // isActive flipping to false; MainTab's always-on no-op useInput
    // has been holding raw-mode throughout.
    terminal.keyEscape();
    await expect(terminal.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });

    // After recovery, 's' should open settings cleanly — if the
    // picker's teardown left any stale handler or raw-mode flag, 's'
    // would either be typed back into a lingering filter or be
    // ignored.
    await openSettings(terminal);
  });
});

// ── T3: Delete confirm absorbs sidebar-bound keys ────────────────

const envT3 = createIsolatedTestEnv({
  scope: 'modal-routing-delete',
  config: {
    aiCommand: 'echo kirby-session-active && sleep 300',
    keybindPreset: 'vim',
  },
});

test.describe('Modal input routing — delete confirm absorbs keypresses', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, envT3.dir] },
    env: {
      ...process.env,
      HOME: envT3.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: envT3.log,
    },
  });

  test('pressing s while confirm-delete is open does not open settings', async ({
    terminal,
  }) => {
    const branchName = 'e2e-modal-delete';

    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    await openBranchPickerAndCreate(terminal, branchName);

    // Open delete-confirm modal.
    terminal.write('x');
    await expect(
      terminal.getByText('to confirm', { strict: false })
    ).toBeVisible({ timeout: 10_000 });

    // 's' is the sidebar 'open settings' key. With the Phase 4
    // refactor, delete-confirm's useInput absorbs all printable input
    // (it's used to type the branch name for confirmation). MainTab's
    // early-return on confirmDelete keeps the sidebar handler out.
    terminal.write('s');
    await new Promise((r) => setTimeout(r, 300));
    await expect(
      terminal.getByText('Settings', { strict: false })
    ).not.toBeVisible({ timeout: 2_000 });
    // The delete-confirm modal must still be up.
    await expect(
      terminal.getByText('to confirm', { strict: false })
    ).toBeVisible();

    // Cancel with Esc so the test cleans up without touching the
    // worktree.
    terminal.keyEscape();
    await expect(
      terminal.getByText('to confirm', { strict: false })
    ).not.toBeVisible({ timeout: 5_000 });
  });
});

// ── T4: Controls Esc returns to settings, not sidebar ────────────

const envT4 = createIsolatedTestEnv({
  scope: 'modal-routing-controls',
  config: 'normie',
});

test.describe('Modal input routing — controls Esc returns to settings', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, envT4.dir] },
    env: {
      ...process.env,
      HOME: envT4.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: envT4.log,
    },
  });

  test('Esc from controls sub-screen lands on settings, not the sidebar', async ({
    terminal,
  }) => {
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();

    // Open settings; the Controls field is first in the list.
    await openSettings(terminal);
    // Enter the controls sub-screen.
    terminal.write('\r');
    await expect(
      terminal.getByText('Navigate down', { strict: false })
    ).toBeVisible();

    // Esc from controls: ControlsPanel's useInput
    // (isActive = settingsOpen && controlsOpen) handles the Esc and
    // flips controlsOpen to false. SettingsPanel's useInput
    // (isActive = settingsOpen && !controlsOpen) becomes active.
    // The sidebar must NOT receive focus during this transition.
    terminal.keyEscape();
    await expect(
      terminal.getByText('Settings', { strict: false })
    ).toBeVisible();
    // 'Navigate down' is controls-sub-screen text and must be gone.
    await expect(
      terminal.getByText('Navigate down', { strict: false })
    ).not.toBeVisible({ timeout: 3_000 });

    // Settings is still up — sidebar 'quit' hint must NOT be showing.
    await expect(terminal.getByText('quit', { strict: false })).not.toBeVisible(
      { timeout: 2_000 }
    );
  });
});
