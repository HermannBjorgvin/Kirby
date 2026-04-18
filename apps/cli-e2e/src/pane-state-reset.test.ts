import { test, expect } from '@microsoft/tui-test';
import {
  MAIN_JS,
  createIsolatedTestEnv,
  openBranchPickerAndCreate,
} from './setup/app.js';

// Smoke test for the Step 16 refactor: MainTabBody is keyed on
// `itemKey`, so usePaneReducer remounts whenever the selected sidebar
// item changes. This exercises the remount pathway without needing a
// real PR — two sibling sessions are enough to prove the selection
// changes get reflected in the pane title.

const env = createIsolatedTestEnv({
  scope: 'pane-reset',
  config: {
    // Keep the PTYs alive so both sessions show as running in the
    // sidebar; navigation-only behaviour is the same whether the PTY
    // is alive or dead.
    aiCommand: 'sleep 300',
    keybindPreset: 'vim',
  },
});

test.describe('Pane state remount on sidebar navigation', () => {
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

  test('pane title follows the selected sidebar item across navigation', async ({
    terminal,
  }) => {
    const branchA = 'e2e-pane-alpha';
    const branchB = 'e2e-pane-bravo';

    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    await expect(terminal.getByText('(no sessions)')).toBeVisible();

    // Create two sessions in order. After creating B, selection is on B.
    await openBranchPickerAndCreate(terminal, branchA);
    await openBranchPickerAndCreate(terminal, branchB);

    // The pane title embeds `sidebar.sessionNameForTerminal`, which is
    // derived from the selected item. After creating B, title should
    // reference B's name.
    await expect(terminal.getByText(branchB, { strict: false })).toBeVisible({
      timeout: 5_000,
    });

    // Navigate up to A. If itemKey doesn't update correctly, the pane
    // would stay keyed on B's key and the title would lag.
    terminal.write('k');
    await new Promise((r) => setTimeout(r, 500));
    await expect(terminal.getByText(branchA, { strict: false })).toBeVisible({
      timeout: 5_000,
    });

    // Navigate back down to B — remount must pick the correct key.
    terminal.write('j');
    await new Promise((r) => setTimeout(r, 500));
    await expect(terminal.getByText(branchB, { strict: false })).toBeVisible({
      timeout: 5_000,
    });
  });
});
