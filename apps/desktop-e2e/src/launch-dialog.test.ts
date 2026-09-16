import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { sessionMenu, sidebarRow, startSessionFromMenu } from './setup/app.js';
import { armContextMenuChoice } from './setup/menu.js';
import type { ElectronApplication } from '@playwright/test';
import {
  findKirbySessionFor,
  socketEnv,
  tagTmuxSession,
} from './setup/tmux.js';

const BRANCH = 'launch-dialog';
const TITLE = `Launch ${'a-very-long-unbroken-title-'.repeat(18)}`;
const REPORT_TIME = '2026-09-09T14:32:00Z';
test.use({
  fakeGitHub: {
    username: 'tester',
    prs: [{ number: 42, title: TITLE, headRefName: BRANCH }],
  },
  repo: { worktrees: [{ branch: BRANCH }] },
});

async function pane(homeDir: string, name: string, format: string) {
  return execFileSync(
    'tmux',
    ['display-message', '-p', '-t', `=${name}:`, format],
    { env: socketEnv(homeDir), encoding: 'utf8' }
  ).trim();
}

async function openMenu(
  page: Parameters<typeof sessionMenu>[0],
  app: ElectronApplication
) {
  await sidebarRow(page, /#42/).first().click();
  await expect(
    page.getByRole('button', { name: `${BRANCH} → main`, exact: true })
  ).toBeVisible();
  const sessions = await page.evaluate(() => window.kirby.listSessions());
  if (!sessions.some((s) => s.running)) {
    await page
      .getByRole('button', { name: /^(Launch|Relaunch) agent$/, exact: true })
      .click();
  } else {
    await armContextMenuChoice(app, 'Session…');
    await sidebarRow(page, /#42/).first().click({ button: 'right' });
  }
  const menu = sessionMenu(page);
  await expect(
    menu.getByRole('button', {
      name: /^(Start new session|Open .+|Continue with .+)$/,
    })
  ).toBeEnabled();
  return menu;
}

test('long titles fit a narrow short window and the Review footer remains reachable', async ({
  desktop,
}) => {
  const { app, page } = desktop;
  const menu = await openMenu(page, app);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(0, 0);
    window.setContentSize(420, 360);
  });
  await menu.getByRole('radio', { name: 'Review', exact: true }).click();
  await expect(
    menu.getByLabel('Additional instructions', { exact: false })
  ).toHaveValue('');
  const button = menu.getByRole('button', {
    name: 'Start review',
    exact: true,
  });
  await expect(button).toBeEnabled();
  const dimensions = await menu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const footer = element
      .querySelector('[data-slot="dialog-footer"]')!
      .getBoundingClientRect();
    return {
      x: box.x,
      right: box.right,
      bottom: box.bottom,
      width: innerWidth,
      height: innerHeight,
      overflow: element.scrollWidth > element.clientWidth,
      footerBottom: footer.bottom,
    };
  });
  expect(dimensions.x).toBeGreaterThanOrEqual(0);
  expect(dimensions.right).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.height);
  expect(dimensions.footerBottom).toBeLessThanOrEqual(dimensions.height);
  expect(dimensions.overflow).toBe(false);
  await page.screenshot({ path: 'test-output/launch-dialog-narrow.png' });
  await menu.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(menu).toBeHidden();
});

test('Orchestra context shows real report metadata only for Continue and preserves it on Open', async ({
  desktop,
}) => {
  const { app, page, homeDir } = desktop;
  await openMenu(page, app);
  await startSessionFromMenu(page);
  await expect(page.getByText('kirby-fake-agent-ready').first()).toBeVisible();
  const name = findKirbySessionFor(BRANCH, homeDir)!;
  tagTmuxSession(
    name,
    {
      '@orchestra-spawner': 'orchestra',
      '@orchestra-orchestrator': 'planning',
      '@orchestra-last-report': `DONE ${REPORT_TIME}`,
    },
    homeDir
  );
  const menu = await openMenu(page, app);
  await expect(
    menu.getByRole('region', { name: 'Orchestra context' })
  ).toBeVisible();
  await expect(menu.getByText('planning', { exact: true })).toBeVisible();
  await expect(menu.getByText('DONE', { exact: true })).toBeVisible();
  await expect(menu.locator('time')).toHaveAttribute('datetime', REPORT_TIME);
  await expect(menu.locator('time')).not.toHaveText('');
  await expect(menu.getByRole('combobox', { name: 'Agent' })).toHaveCount(0);
  await menu.getByRole('radio', { name: 'Review', exact: true }).click();
  await expect(menu.getByText('Orchestra', { exact: true })).toHaveCount(0);
  await expect(menu.getByLabel('Additional instructions')).toBeVisible();
  await menu.getByRole('radio', { name: 'Continue', exact: true }).click();
  await menu.getByRole('button', { name: 'Open Custom', exact: true }).click();
  expect(await pane(homeDir, name, '#{@orchestra-orchestrator}')).toBe(
    'planning'
  );
  expect(await pane(homeDir, name, '#{@orchestra-last-report}')).toBe(
    `DONE ${REPORT_TIME}`
  );
});

test('a stopped unknown agent has no Continue action; a recorded resumable agent does', async ({
  desktop,
}) => {
  const { app, page, homeDir } = desktop;
  await openMenu(page, app);
  await startSessionFromMenu(page);
  await expect(page.getByText('kirby-fake-agent-ready').first()).toBeVisible();
  const name = findKirbySessionFor(BRANCH, homeDir)!;
  const pid = Number(await pane(homeDir, name, '#{pane_pid}'));
  process.kill(pid, 'SIGTERM');
  await expect.poll(() => pane(homeDir, name, '#{pane_dead}')).toBe('1');
  tagTmuxSession(name, { '@orchestra-agent': 'unknown-tool' }, homeDir);
  let menu = await openMenu(page, app);
  await expect(
    menu.getByRole('radio', { name: 'Continue', exact: true })
  ).toHaveCount(0);
  await menu.getByRole('button', { name: 'Cancel' }).click();
  tagTmuxSession(name, { '@orchestra-agent': 'codex' }, homeDir);
  menu = await openMenu(page, app);
  await expect(
    menu.getByRole('button', { name: 'Continue with Codex', exact: true })
  ).toBeEnabled();
  await expect(menu.getByText('Stopped · ready to continue')).toBeVisible();
});

test('Review sends its selected agent and instructions to the same guarded worktree session', async ({
  desktop,
}) => {
  const { app, page, homeDir } = desktop;
  const bin = join(homeDir, 'agent-bin');
  const capture = join(homeDir, 'codex-argv.json');
  mkdirSync(bin);
  const fake = join(bin, 'codex');
  writeFileSync(
    fake,
    `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(
      capture
    )},JSON.stringify(process.argv.slice(2)));\nconsole.log('selected-codex-ready');\nsetInterval(()=>{},60000);\n`
  );
  chmodSync(fake, 0o755);
  await app.evaluate((_electron, path) => {
    process.env.PATH = `${path}:${process.env.PATH}`;
  }, bin);
  await openMenu(page, app);
  await startSessionFromMenu(page);
  await expect(page.getByText('kirby-fake-agent-ready').first()).toBeVisible();
  const name = findKirbySessionFor(BRANCH, homeDir)!;
  tagTmuxSession(
    name,
    {
      '@orchestra-spawner': 'orchestra',
      '@orchestra-orchestrator': 'planning',
      '@orchestra-last-report': `DONE ${REPORT_TIME}`,
    },
    homeDir
  );
  const menu = await openMenu(page, app);
  await menu.getByRole('radio', { name: 'Review', exact: true }).click();
  const picker = menu.getByRole('combobox', { name: 'Agent' });
  await expect(picker).toHaveText('Custom (default)');
  await picker.click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText([
    'Custom (default)',
    'Claude',
    'Codex',
    'Gemini',
    'Copilot',
    'OpenCode',
  ]);
  await page.getByRole('option', { name: 'Codex', exact: true }).click();
  await menu
    .getByLabel('Additional instructions')
    .fill('Check module boundaries.');
  await expect(menu.getByRole('note')).toContainText(
    'stops the running Custom session'
  );
  await menu
    .getByRole('button', { name: 'Stop and start review', exact: true })
    .click();
  await expect(page.getByText('selected-codex-ready').first()).toBeVisible();
  const args: string[] = JSON.parse(readFileSync(capture, 'utf8'));
  expect(args.join('\n')).toContain('Check module boundaries.');
  expect(args.join('\n')).toContain('kirby util add-comment');
  expect(args.join('\n')).toContain('42');
  expect(args).not.toContain('resume');
  expect(findKirbySessionFor(BRANCH, homeDir)).toBe(name);
  expect(await pane(homeDir, name, '#{@orchestra-agent}')).toBe('codex');
  expect(await pane(homeDir, name, '#{@orchestra-spawner}')).toBe('orchestra');
  expect(await pane(homeDir, name, '#{@orchestra-orchestrator}')).toBe('');
  expect(await pane(homeDir, name, '#{@orchestra-last-report}')).toBe('');
  expect(await page.evaluate(() => window.kirby.listSessions())).toHaveLength(
    1
  );
});
