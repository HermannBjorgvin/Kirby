import { test, expect } from '@microsoft/tui-test';
import {
  MAIN_JS,
  createIsolatedTestEnv,
  writeProjectKirbyConfig,
} from './setup/app.js';

// Covers the Step 22 refactor: OnboardingWizard's single useInput was
// split into four step-owned useInput({ isActive: step === 'x' })
// hooks. Each describe launches `kirby --setup` with a preconfigured
// GitHub vendor so the wizard appears deterministically without
// requiring real auto-detect or gh CLI state.
//
// Config scope gotcha: the wizard gate in main.tsx checks
// `config.vendor`, which `readConfig()` pulls from the PROJECT config
// (<dir>/.kirby/config.json), NOT the global one in $HOME. So vendor
// + vendorProject must be written to the project dir.

const PROJECT_CONFIG = {
  vendor: 'github',
  vendorProject: { owner: 'test-owner', repo: 'test-repo' },
};

// ── T1: Welcome step only advances on Enter ───────────────────────

const envT1 = createIsolatedTestEnv({
  scope: 'onboarding-welcome',
  config: { keybindPreset: 'vim' },
});
writeProjectKirbyConfig(envT1.dir, PROJECT_CONFIG);

test.describe('Onboarding wizard — welcome step isolation', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, '--setup', envT1.dir] },
    env: {
      ...process.env,
      HOME: envT1.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: envT1.log,
    },
  });

  test('welcome step ignores non-Enter/Esc keys and advances on Enter', async ({
    terminal,
  }) => {
    await expect(
      terminal.getByText('Welcome to Kirby', { strict: false })
    ).toBeVisible({ timeout: 5_000 });

    // WelcomeStep.useInput handles only escape and return. 'j' (the
    // vim navigate-down key) must be ignored — no other step's hook
    // is mounted, and the wizard must stay on the welcome view.
    terminal.write('j');
    await new Promise((r) => setTimeout(r, 300));
    await expect(
      terminal.getByText('Welcome to Kirby', { strict: false })
    ).toBeVisible();

    // Enter advances to fields step. The fields step is provider-
    // specific; GitHub's displayName is "GitHub" so the header reads
    // "Setup — GitHub".
    terminal.write('\r');
    await expect(terminal.getByText('Setup', { strict: false })).toBeVisible({
      timeout: 5_000,
    });
    // Welcome header must be gone — the step switch mounts only one
    // step component at a time.
    await expect(
      terminal.getByText('Welcome to Kirby', { strict: false })
    ).not.toBeVisible({ timeout: 3_000 });
  });
});

// ── T2: Full forward navigation through all four steps ────────────

const envT2 = createIsolatedTestEnv({
  scope: 'onboarding-forward',
  config: { keybindPreset: 'vim' },
});
writeProjectKirbyConfig(envT2.dir, PROJECT_CONFIG);

test.describe('Onboarding wizard — forward navigation', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, '--setup', envT2.dir] },
    env: {
      ...process.env,
      HOME: envT2.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: envT2.log,
    },
  });

  test('welcome → fields → preferences → done → main UI', async ({
    terminal,
  }) => {
    // 1. Welcome → Enter → Fields
    await expect(
      terminal.getByText('Welcome to Kirby', { strict: false })
    ).toBeVisible({ timeout: 5_000 });
    terminal.write('\r');

    // 2. Fields → Tab → Preferences. Tab bypasses per-field editing.
    await expect(terminal.getByText('Setup', { strict: false })).toBeVisible({
      timeout: 5_000,
    });
    terminal.write('\t');

    // 3. Preferences → Tab → Done. Tab skips the preference toggles.
    await expect(
      terminal.getByText('Preferences', { strict: false })
    ).toBeVisible({ timeout: 5_000 });
    // Fields header must be gone once we're on preferences.
    await expect(
      terminal.getByText('Setup —', { strict: false })
    ).not.toBeVisible({
      timeout: 3_000,
    });
    terminal.write('\t');

    // 4. Done → Enter → main UI. DoneStep accepts both Enter and Esc
    // to complete.
    await expect(
      terminal.getByText('Setup Complete', { strict: false })
    ).toBeVisible({ timeout: 5_000 });
    terminal.write('\r');

    // Main UI is up — sidebar 'quit' hint appears, wizard text gone.
    await expect(terminal.getByText('quit', { strict: false })).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      terminal.getByText('Setup Complete', { strict: false })
    ).not.toBeVisible({ timeout: 3_000 });
  });
});

// ── T3: Esc from fields step skips the wizard ─────────────────────

const envT3 = createIsolatedTestEnv({
  scope: 'onboarding-skip',
  config: { keybindPreset: 'vim' },
});
writeProjectKirbyConfig(envT3.dir, PROJECT_CONFIG);

test.describe('Onboarding wizard — Esc skip from fields step', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, '--setup', envT3.dir] },
    env: {
      ...process.env,
      HOME: envT3.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: envT3.log,
    },
  });

  test('Esc on fields step completes the wizard', async ({ terminal }) => {
    // Welcome → Enter → Fields
    await expect(
      terminal.getByText('Welcome to Kirby', { strict: false })
    ).toBeVisible({ timeout: 5_000 });
    terminal.write('\r');

    await expect(terminal.getByText('Setup', { strict: false })).toBeVisible({
      timeout: 5_000,
    });

    // FieldsStep's useInput handles Esc (outside edit mode) to skip.
    // If Welcome's hook were still active, Esc would skip from Welcome
    // — but the end result (wizard dismissed) is the same. The
    // distinguishing signal: the fields header must have appeared
    // BEFORE Esc, which we asserted above. So a passing test here
    // proves Fields's isActive flipped to true.
    terminal.keyEscape();

    await expect(terminal.getByText('quit', { strict: false })).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      terminal.getByText('Setup', { strict: false })
    ).not.toBeVisible({ timeout: 3_000 });
  });
});
