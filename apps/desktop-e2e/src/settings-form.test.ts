import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { tab } from './setup/app.js';
import { clickAppMenuItem } from './setup/menu.js';

/**
 * The settings form itself.
 *
 * The host side of every write has unit tests, but the controls in
 * front of it do not: a text row saves on blur and on Enter, a select
 * saves on change, a switch saves immediately. Wire one to the wrong
 * handler — or forget to save at all — and the page looks perfectly
 * normal while nothing reaches disk. Driving the real controls is the
 * only way to see that.
 */

function config(homeDir: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(homeDir, '.kirby', 'config.json'), 'utf8')
  ) as Record<string, unknown>;
}

/** Per-project config, keyed by a hash of the repo path. */
function projectConfig(
  homeDir: string,
  repoPath: string
): Record<string, unknown> {
  const key = createHash('sha256').update(repoPath).digest('hex').slice(0, 16);
  return JSON.parse(
    readFileSync(
      join(homeDir, '.kirby', 'projects', key, 'config.json'),
      'utf8'
    )
  ) as Record<string, unknown>;
}

function prefs(homeDir: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(homeDir, '.kirby', 'desktop-prefs.json'), 'utf8')
  ) as Record<string, unknown>;
}

async function openSettings(app: ElectronApplication, page: Page) {
  await clickAppMenuItem(app, 'Settings…');
  await expect(tab(page, /Settings/)).toBeVisible();
}

test.describe('Settings form', () => {
  test('saves a text field on Enter', async ({ desktop }) => {
    const { app, page, homeDir } = desktop;
    await openSettings(app, page);

    const path = page.getByLabel('Worktree Path', { exact: true });
    await path.fill('/tmp/on-enter');
    await path.press('Enter');

    await expect
      .poll(() => config(homeDir).worktreePath, { timeout: 15_000 })
      .toBe('/tmp/on-enter');
  });

  test('routes a project-scoped field to the project config, not the global one', async ({
    desktop,
  }) => {
    const { app, page, homeDir, repoPath } = desktop;
    await openSettings(app, page);

    // Email belongs to the per-project bag. The client names a field and
    // the host decides where it lands, so this is the visible end of
    // that: writing it into the global config would leak one repo's
    // identity into every other one.
    const email = page.getByLabel('Email', { exact: true });
    await email.fill('me@example.test');
    await email.press('Enter');

    await expect
      .poll(() => projectConfig(homeDir, repoPath).email, { timeout: 15_000 })
      .toBe('me@example.test');
    expect(config(homeDir).email).toBeUndefined();
  });

  test('saves a text field on blur, without needing Enter', async ({
    desktop,
  }) => {
    const { app, page, homeDir } = desktop;
    await openSettings(app, page);

    // Clicking away is how most people leave a field.
    await page
      .getByLabel('Worktree Path', { exact: true })
      .fill('/tmp/on-blur');
    await page.getByLabel('Email', { exact: true }).click();

    await expect
      .poll(() => config(homeDir).worktreePath, { timeout: 15_000 })
      .toBe('/tmp/on-blur');
  });

  test('clearing a field removes it rather than storing an empty string', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;

    // Driven through the bridge rather than the form. The input is
    // controlled and the settings query refetches after every save, so
    // a refetch landing between "clear the field" and "press Enter"
    // repopulates it and the clear is lost — a person sees the value
    // reappear and retypes, but a test types faster than the round trip
    // and the assertion turns flaky. Written as a UI test it failed
    // about one run in eight, which is worse than not having it.
    await page.evaluate(() =>
      window.kirby.updateSettingsField(
        { label: 'Worktree Path', key: 'worktreePath' },
        '/tmp/temporary'
      )
    );
    expect(config(homeDir).worktreePath).toBe('/tmp/temporary');

    await page.evaluate(() =>
      window.kirby.updateSettingsField(
        { label: 'Worktree Path', key: 'worktreePath' },
        ''
      )
    );
    // An empty string would shadow the default instead of falling back
    // to it, so the key has to go rather than be emptied.
    expect(config(homeDir).worktreePath).toBeUndefined();
  });

  test('a select writes the value that was picked', async ({ desktop }) => {
    const { app, page, homeDir } = desktop;
    await openSettings(app, page);

    // A different agent from the current one: a select only fires on
    // change, so picking what is already selected proves nothing.
    await page.getByLabel('AI Tool', { exact: true }).click();
    await page.getByRole('option', { name: /codex/i }).click();

    await expect
      .poll(() => config(homeDir).agentId, { timeout: 15_000 })
      .toBe('codex');
  });

  test('a switch writes straight through to the desktop preferences', async ({
    desktop,
  }) => {
    const { app, page, homeDir } = desktop;
    await openSettings(app, page);

    // Window chrome is a desktop preference, not app config: the main
    // process reads it before a window exists, so it lives elsewhere.
    await page.getByLabel('Native window frame', { exact: true }).click();
    await expect
      .poll(() => prefs(homeDir).nativeFrame, { timeout: 15_000 })
      .toBe(true);
  });

  test('every group in the rail reaches a section', async ({ desktop }) => {
    const { app, page } = desktop;
    await openSettings(app, page);

    // The rail scrolls one long page rather than swapping panes, so a
    // group whose heading is missing is a rail entry that goes nowhere.
    for (const group of ['Appearance', 'General', 'Agent', 'Terminal']) {
      await page.getByRole('button', { name: group, exact: true }).click();
      await expect(
        page.getByRole('heading', { name: group, exact: true })
      ).toBeVisible();
    }
  });
});
