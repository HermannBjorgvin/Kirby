import { test, expect } from '@microsoft/tui-test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestRepo, registerCleanup } from './setup/git-repo.js';

// Isolated HOME so the test controls the kirby config (aiCommand, keybinds).
function createIsolatedTestEnv() {
  const dir = createTestRepo();
  const home = mkdtempSync(join(tmpdir(), 'kirby-autohide-home-'));
  registerCleanup(dir);
  registerCleanup(home);

  const kd = join(home, '.kirby');
  mkdirSync(kd, { recursive: true });
  writeFileSync(
    join(kd, 'config.json'),
    JSON.stringify({
      aiCommand: 'echo kirby-session-active && sleep 300',
      keybindPreset: 'vim',
    }),
    'utf-8'
  );

  return { dir, home };
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

test.describe('Sidebar auto-hide', () => {
  test.use({
    rows: 30,
    columns: 100,
    program: { file: 'node', args: [mainJs, env.dir] },
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
    terminal.write('c');
    await expect(terminal.getByText('Branch Picker')).toBeVisible();
    await typeText(terminal, branchName);
    await expect(
      terminal.getByText('(new branch)', { strict: false })
    ).toBeVisible({ timeout: 5_000 });
    // Let React re-render so useInput closure captures the updated filter
    await new Promise((r) => setTimeout(r, 2_000));
    terminal.write('\r');

    // 3. Session is visible in the sidebar
    await expect(terminal.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(terminal.getByText(branchName, { strict: false })).toBeVisible(
      { timeout: 10_000 }
    );

    // 4. Tab → PTY starts, focus moves to terminal, sidebar hides
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

    // 5. Ctrl+Space exits the terminal pane → sidebar reappears
    //    (Tab is forwarded into the PTY when focused on the agent, so the
    //    exit key is \x00 — see useRawStdinForward.ts)
    terminal.write('\x00');
    await expect(terminal.getByText('quit', { strict: false })).toBeVisible({
      timeout: 5_000,
    });
  });
});
