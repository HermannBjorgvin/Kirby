import { test, expect } from './fixtures/kirby.js';

// Vim preset for the keybindings this test uses (s settings, c branch
// picker, K kill, x delete). We deliberately do NOT pre-set aiCommand —
// the test configures it through the settings UI.
test.use({
  kirbyConfig: { keybindPreset: 'vim' },
});

test.describe('Terminal Input', () => {
  test('configure agent via settings, run command, escape, and clean up', async ({
    kirby,
  }) => {
    const branchName = 'e2e-raw-input';

    // ── 1. Startup ───────────────────────────────────────────────
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible();

    // ── 2. Open settings → set AI Tool to 'bash' ─────────────────
    await kirby.term.type('s');
    await expect(kirby.term.getByText('Settings').first()).toBeVisible();

    // Controls is first field — navigate down to AI Tool.
    await kirby.term.type('j');
    await kirby.term.page.waitForTimeout(300);
    // Enter custom-edit mode for AI Tool.
    await kirby.term.press('Enter');
    await kirby.term.page.waitForTimeout(500);

    // Type the custom command.
    await kirby.term.type('bash');
    await kirby.term.page.waitForTimeout(500);

    // Save with Enter.
    await kirby.term.press('Enter');

    // Verify the custom value is displayed.
    await expect(kirby.term.getByText('Custom: bash').first()).toBeVisible();

    // Close settings — wait for save to settle, then press Esc.
    // Can't assert on 'Settings' visibility because getByText is
    // case-insensitive and matches both the panel title and the sidebar
    // keybind hint ("s settings"). Check for the AI Tool label (panel-only).
    await kirby.term.page.waitForTimeout(1_000);
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
    await kirby.term.page.waitForTimeout(2_000);
    await kirby.term.press('Enter');

    await expect(kirby.term.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(kirby.term.getByText(branchName).first()).toBeVisible({
      timeout: 10_000,
    });

    // ── 4. Tab to start bash session and focus terminal ──────────
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('ctrl+space to exit').first()
    ).toBeVisible({ timeout: 10_000 });

    // Give bash a moment to initialize.
    await kirby.term.page.waitForTimeout(1_000);

    // ── 5. Type a command and verify output ──────────────────────
    // Use tr to lowercase the output so command and output are distinct:
    //   command line: echo KIRBY_RAW_TEST | tr A-Z a-z
    //   output line:  kirby_raw_test
    await kirby.term.type('echo KIRBY_RAW_TEST | tr A-Z a-z');
    await kirby.term.page.waitForTimeout(500);
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
    await kirby.term.page.waitForTimeout(2_000);

    // ── 8. Delete the branch ─────────────────────────────────────
    await kirby.term.type('x');
    await expect(kirby.term.getByText('to confirm').first()).toBeVisible({
      timeout: 10_000,
    });

    await kirby.term.type(branchName);
    await kirby.term.page.waitForTimeout(2_000);
    await kirby.term.press('Enter');

    // Session disappears.
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible({
      timeout: 15_000,
    });
  });
});
