import { test, expect } from '@microsoft/tui-test';
import {
  MAIN_JS,
  createIsolatedTestEnv,
  deleteSelectedSession,
  openBranchPickerAndCreate,
  openSettings,
  typeText,
} from './setup/app.js';

const env = createIsolatedTestEnv({ scope: 'input' });

test.describe('Terminal Input', () => {
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

  test('configure agent via settings, run command, escape, and clean up', async ({
    terminal,
  }) => {
    const branchName = 'e2e-raw-input';

    // ── 1. Wait for startup ──────────────────────────────────────
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();

    // ── 2. Open settings and set AI Tool to 'bash' ──────────────
    await openSettings(terminal);

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
    await openBranchPickerAndCreate(terminal, branchName);

    // ── 4. Tab to start bash session and focus terminal ──────────
    terminal.write('\t');
    await expect(
      terminal.getByText('ctrl+space to exit', { strict: false })
    ).toBeVisible({ timeout: 10_000 });

    // Wait for bash's prompt to finish painting before we type —
    // typing too early interleaves the user input with the prompt
    // render and mangles both. 'e2e-raw-input' is the branch name,
    // which shows up in bash's cwd segment of the prompt (\`…/worktrees/e2e-raw-input$\`).
    // That's a deterministic signal that the PTY has reached the
    // prompt state, unlike the 1s fixed-sleep this replaces which
    // was routinely too short on slower CI hosts.
    await expect(
      terminal.getByText('e2e-raw-input$', { strict: false })
    ).toBeVisible({ timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 500));

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
    await deleteSelectedSession(terminal, branchName);
  });
});
