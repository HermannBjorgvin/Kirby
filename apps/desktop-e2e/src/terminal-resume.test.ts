import { execFileSync } from 'node:child_process';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  confirmNewTerminal,
  openNewTerminalDialog,
  terminalSessions,
  terminalTabs,
} from './setup/terminals.js';
import { socketEnv } from './setup/tmux.js';

test.use({ n10Config: { aiCommand: fakeAgent({ exitAfterMs: 5000 }) } });

test('an exited agent terminal resumes in its existing tab and tmux session', async ({
  desktop,
}) => {
  const { app, page, homeDir } = desktop;
  await openNewTerminalDialog(app, page);
  await confirmNewTerminal(page, 'Agent');
  await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible();
  await expect(terminalTabs(page)).toHaveCount(1);
  const [name] = terminalSessions(homeDir);
  const panePid = () =>
    execFileSync(
      'tmux',
      ['display-message', '-p', '-t', `=${name}:`, '#{pane_pid}'],
      {
        env: socketEnv(homeDir),
        encoding: 'utf8',
      }
    ).trim();
  const initialPid = panePid();
  const [before] = await page.evaluate(() => window.n10.listTerminals());
  const resume = page.getByRole('button', {
    name: 'Resume agent',
    exact: true,
  });
  await expect(resume).toBeVisible({ timeout: 15_000 });
  expect(terminalSessions(homeDir)).toEqual([name]);

  await resume.click();
  await expect(resume).toBeHidden();
  await expect.poll(panePid).not.toBe(initialPid);
  await expect(terminalTabs(page)).toHaveCount(1);
  const [after] = await page.evaluate(() => window.n10.listTerminals());
  expect(after).toMatchObject({ name: before.name, running: true });
  expect(terminalSessions(homeDir)).toEqual([name]);
});
