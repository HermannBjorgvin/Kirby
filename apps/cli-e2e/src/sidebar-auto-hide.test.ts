import { test, expect } from '@microsoft/tui-test';
import {
  MAIN_JS,
  createIsolatedTestEnv,
  openBranchPickerAndCreate,
} from './setup/app.js';

const env = createIsolatedTestEnv({
  scope: 'autohide',
  config: {
    aiCommand: 'echo kirby-session-active && sleep 300',
    keybindPreset: 'vim',
  },
});

test.describe('Sidebar auto-hide', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [MAIN_JS, env.dir] },
    env: {
      ...process.env,
      HOME: env.home,
      TERM: 'xterm-256color',
    },
  });

  test('hides on Tab into a session and reappears on Tab out', async ({
    terminal,
  }) => {
    const branchName = 'autohide-e2e';

    // 1. Empty state
    await expect(terminal.getByText('(no sessions)')).toBeVisible();

    // 2. Create a session via the branch picker
    await openBranchPickerAndCreate(terminal, branchName);

    // 3. Tab → PTY starts, focus moves to terminal, sidebar hides
    //    The session name may still be visible as the main pane title, so
    //    assert on a sidebar-only element (keybind hint "quit") instead of
    //    the branch name.
    terminal.write('\t');
    await expect(
      terminal.getByText('kirby-session-active', { strict: false })
    ).toBeVisible({ timeout: 10_000 });
    await expect(terminal.getByText('quit', { strict: false })).not.toBeVisible(
      { timeout: 5_000 }
    );

    // 4. Ctrl+Space exits the terminal pane → sidebar reappears
    //    (Tab is forwarded into the PTY when focused on the agent, so the
    //    exit key is \x00 — see useRawStdinForward.ts)
    terminal.write('\x00');
    await expect(terminal.getByText('quit', { strict: false })).toBeVisible({
      timeout: 5_000,
    });
  });
});
