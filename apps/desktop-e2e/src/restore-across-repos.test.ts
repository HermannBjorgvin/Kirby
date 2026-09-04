import { realpathSync } from 'node:fs';
import { test as base, expect } from './fixtures/desktop.js';
import { tab, visibleText } from './setup/app.js';
import { cleanupExternalSessions, tmuxAvailable } from './setup/external.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';

/**
 * Quit with agents open across two repositories, relaunch on one of
 * them: both agents are still running in tmux, and both get their tabs
 * back — the open repository's through discovery, the other's as a
 * strip entry in its own group that opens that repository when clicked.
 */
const ALPHA = 'e2e-ext-alpha-restored';
const BETA = 'e2e-ext-beta-restored';

function agentCommand(banner: string): string {
  return `printf '%s\\n' ${banner}; sleep 300`;
}

// The other repository is a fixture rather than a describe-scope
// constant, so it exists only for a test that asks — and is cleaned up
// only then too (see terminal-tabs-tmux.test.ts for why).
const test = base.extend<{ other: string }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  other: async ({}, provide) => {
    const dir = createTestRepo({ name: 'repo-beta' });
    await provide(dir);
    cleanupTestRepo(dir);
  },
  liveSessions: async ({ other }, provide) => {
    await provide([
      { branch: ALPHA, command: agentCommand('alpha-agent-here') },
      { branch: BETA, command: agentCommand('beta-agent-here'), repo: other },
    ]);
  },
});

test.skip(!tmuxAvailable(), 'tmux is not installed');

test.use({
  kirbyConfig: { terminalBackend: 'tmux' },
  repo: { name: 'repo-alpha' },
});

test.afterEach(({ desktop, other }) => {
  cleanupExternalSessions(desktop.repoPath, [ALPHA], desktop.homeDir);
  cleanupExternalSessions(other, [BETA], desktop.homeDir);
});

test.describe('Agents restored across repositories', () => {
  test('every repository’s live agent gets its tab back in its own group', async ({
    desktop,
    other,
  }) => {
    const { page, repoPath } = desktop;
    const getRepo = () => page.evaluate(() => window.kirby.getRepo());

    // The open repository's agent: attached, and on the strip.
    await expect(tab(page, new RegExp(ALPHA))).toBeVisible({
      timeout: 30_000,
    });
    // The other repository's: on the strip in its group, prefixed with
    // that repository's name — and the workspace stayed where it opened.
    const beta = tab(page, new RegExp(`repo-beta\\s*/\\s*${BETA}`));
    await expect(beta).toBeVisible({ timeout: 30_000 });
    // Two groups on the strip: whichever of the two tabs is second
    // starts one (the leftmost group never draws a boundary).
    await expect(
      page.locator('[role="tab"][data-starts-group="true"]')
    ).toHaveCount(1);
    expect(await getRepo()).toMatchObject({ cwd: repoPath });

    // Activating it opens its repository, whose own discovery attaches
    // the agent that was running there all along.
    await beta.click();
    await expect
      .poll(getRepo, { timeout: 30_000 })
      .toMatchObject({ cwd: realpathSync(other) });
    await expect(visibleText(page, 'beta-agent-here')).toBeVisible({
      timeout: 30_000,
    });
    // One tab for that agent, not a second one opened by the switch.
    await expect(tab(page, new RegExp(BETA))).toHaveCount(1);
  });
});
