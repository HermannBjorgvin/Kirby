import { test, expect } from '@microsoft/tui-test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestRepo, registerCleanup } from './setup/git-repo.js';

// ── Helpers ────────────────────────────────────────────────────────

function createIsolatedTestEnv() {
  const dir = createTestRepo();
  const home = mkdtempSync(join(tmpdir(), 'kirby-input-home-'));
  const log = join(tmpdir(), `kirby-input-${Date.now()}.log`);
  registerCleanup(dir);
  registerCleanup(home);

  // Create .kirby dir with vim preset — the test uses vim keybindings
  // (s for settings, c for branch picker, K for kill, x for delete).
  // Do NOT pre-configure aiCommand — the test sets it through the settings UI.
  mkdirSync(join(home, '.kirby'), { recursive: true });
  writeFileSync(
    join(home, '.kirby', 'config.json'),
    JSON.stringify({ keybindPreset: 'vim' }),
    'utf-8'
  );

  return { dir, home, log };
}

async function typeText(
  terminal: { write: (s: string) => void },
  text: string
) {
  for (const ch of text) {
    terminal.write(ch);
    await new Promise((r) => setTimeout(r, 80));
  }
}

const mainJs = resolve('../cli/dist/main.js');
const env = createIsolatedTestEnv();

// ── Test ──────────────────────────────────────────────────────────

test.describe('Terminal Input', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [mainJs, env.dir] },
    env: {
      ...process.env,
      HOME: env.home,
      TERM: 'xterm-256color',
      KIRBY_LOG: env.log,
    },
  });

  test('configure agent via settings, run command, escape, and clean up', async ({
    terminal,
  }) => {
    const branchName = 'e2e-raw-input';

    // ── 1. Wait for startup ──────────────────────────────────────
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();

    // ── 2. Open settings and set AI Tool to 'bash' ──────────────
    terminal.write('s');
    await expect(
      terminal.getByText('Settings', { strict: false })
    ).toBeVisible();

    // Controls is the first field — navigate down to AI Tool.
    terminal.write('j');
    await new Promise((r) => setTimeout(r, 300));
    // Press Enter to enter custom edit mode for AI Tool.
    terminal.write('\r');
    await new Promise((r) => setTimeout(r, 500));

    // Type the custom command
    await typeText(terminal, 'bash');
    await new Promise((r) => setTimeout(r, 500));

    // Save with Enter
    terminal.write('\r');

    // Verify the custom value is displayed
    await expect(
      terminal.getByText('Custom: bash', { strict: false })
    ).toBeVisible();

    // Close settings — wait for save to settle, then press Esc
    await new Promise((r) => setTimeout(r, 1_000));
    terminal.keyEscape();
    await expect(
      terminal.getByText('Settings', { strict: false })
    ).not.toBeVisible({ timeout: 5_000 });

    // ── 3. Create session via branch picker ──────────────────────
    terminal.write('c');
    await expect(terminal.getByText('Branch Picker')).toBeVisible();

    await typeText(terminal, branchName);
    await expect(
      terminal.getByText('(new branch)', { strict: false })
    ).toBeVisible({ timeout: 5_000 });

    // Let React re-render so useInput closure captures updated branchFilter
    await new Promise((r) => setTimeout(r, 2_000));
    terminal.write('\r');

    // Wait for branch picker to close, then session to appear
    await expect(terminal.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(terminal.getByText(branchName, { strict: false })).toBeVisible(
      { timeout: 10_000 }
    );

    // ── 4. Tab to start bash session and focus terminal ──────────
    terminal.write('\t');
    await expect(
      terminal.getByText('ctrl+space to exit', { strict: false })
    ).toBeVisible({ timeout: 10_000 });

    // Give bash a moment to initialize
    await new Promise((r) => setTimeout(r, 1_000));

    // ── 5. Type a command and verify output ──────────────────────
    // Use tr to lowercase the output so command and output are distinct:
    //   command line: echo KIRBY_RAW_TEST | tr A-Z a-z
    //   output line:  kirby_raw_test
    await typeText(terminal, 'echo KIRBY_RAW_TEST | tr A-Z a-z');
    await new Promise((r) => setTimeout(r, 500));
    terminal.write('\r');

    // 1) The typed command is visible (proves input was forwarded to bash)
    await expect(
      terminal.getByText('KIRBY_RAW_TEST', { strict: false })
    ).toBeVisible({ timeout: 10_000 });
    // 2) The lowercase output is visible (proves the command executed)
    await expect(
      terminal.getByText('kirby_raw_test', { strict: false })
    ).toBeVisible({ timeout: 5_000 });

    // ── 6. Ctrl+Space to exit terminal focus ─────────────────────
    terminal.write('\x00');

    // Terminal should no longer show the focus indicator
    await expect(
      terminal.getByText('ctrl+space to exit', { strict: false })
    ).not.toBeVisible({ timeout: 5_000 });

    // Verify sidebar keybind hints are visible again
    await expect(terminal.getByText('quit', { strict: false })).toBeVisible({
      timeout: 3_000,
    });

    // ── 7. Kill the agent session ────────────────────────────────
    terminal.write('K');
    await new Promise((r) => setTimeout(r, 2_000));

    // ── 8. Delete the branch ─────────────────────────────────────
    terminal.write('x');
    await expect(
      terminal.getByText('to confirm', { strict: false })
    ).toBeVisible({ timeout: 10_000 });

    await typeText(terminal, branchName);
    await new Promise((r) => setTimeout(r, 2_000));
    terminal.write('\r');

    // Session should disappear
    await expect(terminal.getByText('(no sessions)')).toBeVisible({
      timeout: 15_000,
    });
  });
});
