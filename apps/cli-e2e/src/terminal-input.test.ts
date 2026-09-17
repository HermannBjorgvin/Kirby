import { test, expect } from './fixtures/n10.js';
import { startFromSessionMenu } from './setup/sessions.js';
import { settleFor } from './setup/waits.js';

// Vim preset for the keybindings this test uses (s settings, c branch
// picker, K kill, x delete). `aiCommand: 'bash'` is an unrecognized
// command, so it resolves to the hidden test-runner agent and spawns a
// real bash we can drive to verify terminal I/O forwarding.
test.use({
  n10Config: { keybindPreset: 'vim', aiCommand: 'bash' },
});

test.describe('Terminal Input', () => {
  test('run a command in an agent session, escape, and clean up', async ({
    n10,
  }) => {
    const branchName = 'e2e-raw-input';

    // ── 1. Startup ───────────────────────────────────────────────
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();

    // ── 2. Settings smoke: open and close ────────────────────────
    await n10.term.type('s');
    await expect(n10.term.getByText('Settings').first()).toBeVisible();
    await expect(n10.term.getByText('AI Tool').first()).toBeVisible();

    // Close settings. Can't assert on 'Settings' visibility because
    // getByText is case-insensitive and matches both the panel title and
    // the sidebar keybind hint ("s settings"). Check for the AI Tool
    // label (panel-only) — asserted open above, so Escape has something
    // to close.
    await n10.term.press('Escape');
    await expect(n10.term.getByText('AI Tool').first()).not.toBeVisible({
      timeout: 5_000,
    });

    // ── 3. Create session via branch picker ──────────────────────
    await n10.term.type('c');
    await expect(n10.term.getByText('Branch Picker')).toBeVisible();

    await n10.term.type(branchName);
    await expect(n10.term.getByText(/\(new branch\)/).first()).toBeVisible({
      timeout: 5_000,
    });

    // Let React re-render so useInput closure captures the updated filter.
    await settleFor(
      n10.term.page,
      2_000,
      "Ink's useInput captured the old filter until the next render"
    );
    await n10.term.press('Enter');

    await expect(n10.term.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(n10.term.getByText(branchName).first()).toBeVisible({
      timeout: 10_000,
    });

    // ── 4. Start the bash session from the menu, focus terminal ──
    await startFromSessionMenu(n10.term);
    await expect(n10.term.getByText('ctrl+space to exit').first()).toBeVisible({
      timeout: 10_000,
    });

    // ── 5. Type a command and verify output ──────────────────────
    // Use tr to lowercase the output so command and output are distinct:
    //   command line: echo N10_RAW_TEST | tr A-Z a-z
    //   output line:  n10_raw_test
    //
    // bash prints nothing to wait on before its first prompt, and under
    // the tmux backend keystrokes sent before the client has attached
    // are lost rather than buffered. So the line is typed until the PTY
    // echoes it, clearing whatever partial line an earlier attempt left
    // (Ctrl+U) first — Enter landing on a truncated command would run
    // the wrong thing.
    await expect(async () => {
      await n10.term.write('\x15');
      await n10.term.type('echo N10_RAW_TEST | tr A-Z a-z');
      await expect(n10.term.getByText('N10_RAW_TEST').first()).toBeVisible({
        timeout: 3_000,
      });
    }).toPass({ timeout: 30_000, intervals: [500, 1_000] });
    await n10.term.press('Enter');

    // 1) Typed command visible (input was forwarded to bash)
    await expect(n10.term.getByText('N10_RAW_TEST').first()).toBeVisible({
      timeout: 10_000,
    });
    // 2) Lowercase output visible (command executed)
    await expect(n10.term.getByText('n10_raw_test').first()).toBeVisible({
      timeout: 5_000,
    });

    // ── 6. Ctrl+Space to exit terminal focus ─────────────────────
    await n10.term.write('\x00');

    // Terminal should no longer show the focus indicator.
    await expect(
      n10.term.getByText('ctrl+space to exit').first()
    ).not.toBeVisible({ timeout: 5_000 });

    // Sidebar keybind hints visible again.
    await expect(n10.term.getByText('quit').first()).toBeVisible({
      timeout: 3_000,
    });

    // ── 7. Kill the agent session ────────────────────────────────
    await n10.term.type('K');
    await settleFor(
      n10.term.page,
      2_000,
      'the kill to finish before the branch delete asks about it'
    );

    // ── 8. Delete the branch ─────────────────────────────────────
    await n10.term.type('x');
    await expect(n10.term.getByText('to confirm').first()).toBeVisible({
      timeout: 10_000,
    });

    await n10.term.type(branchName);
    await settleFor(
      n10.term.page,
      2_000,
      'the typed branch name to reach the confirm field before Enter'
    );
    await n10.term.press('Enter');

    // Session disappears.
    await expect(n10.term.getByText('(no sessions)')).toBeVisible({
      timeout: 15_000,
    });
  });
});
