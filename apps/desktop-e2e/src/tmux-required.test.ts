import { execFileSync } from 'node:child_process';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, launchAgentFromRail, tab } from './setup/app.js';
import { clickAppMenuItem } from './setup/menu.js';
import {
  findN10SessionFor,
  n10SessionExists,
  socketEnv,
  tmuxClientPids,
} from './setup/tmux.js';

for (const legacyBackend of [undefined, 'pty']) {
  test.describe(`Required tmux (stored backend: ${
    legacyBackend ?? 'absent'
  })`, () => {
    test.use({ n10Config: { terminalBackend: legacyBackend } });

    test('launches an agent in tmux without a backend selector', async ({
      desktop,
    }) => {
      const { page, homeDir, app } = desktop;
      await createWorktree(page, 'tmux-required');
      await launchAgentFromRail(page);
      await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible({
        timeout: 30_000,
      });
      expect(n10SessionExists('tmux-required', homeDir)).toBe(true);

      await clickAppMenuItem(app, 'Settings…');
      await expect(tab(page, /Settings/)).toBeVisible();
      await expect(
        page.getByLabel('Terminal Backend', { exact: true })
      ).toHaveCount(0);
    });
  });
}

test('quitting detaches the app and leaves its agent session running', async ({
  desktop,
}) => {
  const { page, app, homeDir } = desktop;
  await createWorktree(page, 'survives-quit');
  await launchAgentFromRail(page);
  await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible();
  const session = findN10SessionFor('survives-quit', homeDir);
  expect(session).toBeDefined();

  // Close before fixture cleanup: a tmux server inheriting Electron's
  // descriptors would keep Playwright waiting here until the agent dies.
  await app.close();

  expect(findN10SessionFor('survives-quit', homeDir)).toBe(session);
  await expect.poll(() => tmuxClientPids(session!, homeDir)).toEqual([]);
  expect(
    execFileSync(
      'tmux',
      ['display-message', '-p', '-t', `=${session}:`, '#{pane_dead}'],
      { env: socketEnv(homeDir), encoding: 'utf8' }
    ).trim()
  ).toBe('0');
});
