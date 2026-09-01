import { test, expect } from './fixtures/kirby.js';
import { startFromSessionMenu } from './setup/sessions.js';
import { settleFor } from './setup/waits.js';

// Vim preset for the keybindings this test uses (s settings, c branch
// picker, K kill, x delete). `aiCommand: 'bash'` is an unrecognized
// command, so it resolves to the hidden test-runner agent and spawns a
// real bash we can drive to verify terminal I/O forwarding.
test.use({
  kirbyConfig: { keybindPreset: 'vim', aiCommand: 'bash' },
});

test.describe('Terminal Input', () => {
  test('run a command in an agent session, escape, and clean up', async ({
    kirby,
  }) => {
    const branchName = 'e2e-raw-input';

    // ── 1. Startup ───────────────────────────────────────────────
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible();

    // ── 2. Settings smoke: open and close ────────────────────────
    await kirby.term.type('s');
    await expect(kirby.term.getByText('Settings').first()).toBeVisible();
    await expect(kirby.term.getByText('AI Tool').first()).toBeVisible();

    // Close settings. Can't assert on 'Settings' visibility because
    // getByText is case-insensitive and matches both the panel title and
    // the sidebar keybind hint ("s settings"). Check for the AI Tool
    // label (panel-only) — asserted open above, so Escape has something
    // to close.
    await kirby.term.press('Escape');
    await expect(kirby.term.getByText('AI Tool').first()).not.toBeVisible({
      timeout: 5_000,
    });

    // ── 3. Create session via branch picker ──────────────────────
    await kirby.term.type('c');
    await expect(kirby.term.getByText('Branch Picker')).toBeVisible();

    await kirby.term.type(branchName);
    await expect(kirby.term.getByText(/\(new branch\)/).first()).toBeVisible({
      timeout: 5_000,
    });

    // Let React re-render so useInput closure captures the updated filter.
    await settleFor(
      kirby.term.page,
      2_000,
      "Ink's useInput captured the old filter until the next render"
    );
    await kirby.term.press('Enter');

    await expect(kirby.term.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(kirby.term.getByText(branchName).first()).toBeVisible({
      timeout: 10_000,
    });

    // ── 4. Start the bash session from the menu, focus terminal ──
    await startFromSessionMenu(kirby.term);
    await expect(
      kirby.term.getByText('ctrl+space to exit').first()
    ).toBeVisible({ timeout: 10_000 });

    // ── 5. Type a command and verify output ──────────────────────
    // Use tr to lowercase the output so command and output are distinct:
    //   command line: echo KIRBY_RAW_TEST | tr A-Z a-z
    //   output line:  kirby_raw_test
    //
    // bash prints nothing to wait on before its first prompt, and under
    // the tmux backend keystrokes sent before the client has attached
    // are lost rather than buffered. So the line is typed until the PTY
    // echoes it, clearing whatever partial line an earlier attempt left
    // (Ctrl+U) first — Enter landing on a truncated command would run
    // the wrong thing.
    await expect(async () => {
      await kirby.term.write('\x15');
      await kirby.term.type('echo KIRBY_RAW_TEST | tr A-Z a-z');
      await expect(kirby.term.getByText('KIRBY_RAW_TEST').first()).toBeVisible({
        timeout: 3_000,
      });
    }).toPass({ timeout: 30_000, intervals: [500, 1_000] });
    await kirby.term.press('Enter');

    // 1) Typed command visible (input was forwarded to bash)
    await expect(kirby.term.getByText('KIRBY_RAW_TEST').first()).toBeVisible({
      timeout: 10_000,
    });
    // 2) Lowercase output visible (command executed)
    await expect(kirby.term.getByText('kirby_raw_test').first()).toBeVisible({
      timeout: 5_000,
    });

    // ── 6. Ctrl+Space to exit terminal focus ─────────────────────
    await kirby.term.write('\x00');

    // Terminal should no longer show the focus indicator.
    await expect(
      kirby.term.getByText('ctrl+space to exit').first()
    ).not.toBeVisible({ timeout: 5_000 });

    // Sidebar keybind hints visible again.
    await expect(kirby.term.getByText('quit').first()).toBeVisible({
      timeout: 3_000,
    });

    // ── 7. Kill the agent session ────────────────────────────────
    await kirby.term.type('K');
    await settleFor(
      kirby.term.page,
      2_000,
      'the kill to finish before the branch delete asks about it'
    );

    // ── 8. Delete the branch ─────────────────────────────────────
    await kirby.term.type('x');
    await expect(kirby.term.getByText('to confirm').first()).toBeVisible({
      timeout: 10_000,
    });

    await kirby.term.type(branchName);
    await settleFor(
      kirby.term.page,
      2_000,
      'the typed branch name to reach the confirm field before Enter'
    );
    await kirby.term.press('Enter');

    // Session disappears.
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible({
      timeout: 15_000,
    });
  });
});
