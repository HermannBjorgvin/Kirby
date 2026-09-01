import { test, expect, fakeAgentCommand } from './fixtures/kirby.js';
import { createSession } from './setup/sessions.js';
import {
  UNSET_BACKEND,
  cleanupTmuxSessions,
  kirbySessionExists,
  listTmuxSessions,
  tmuxAvailable,
  uniqueTmuxBranch,
} from './setup/tmux.js';

/**
 * The backend nobody chose.
 *
 * `tmux-backend.test.ts` proves the wiring works when a config asks for
 * tmux. This file is about the other half: on a machine that has tmux
 * and a config that says nothing, sessions have to come out as tmux
 * sessions — and a config that says `"pty"` has to stay PTY forever,
 * however much tmux is installed.
 *
 * Skipped without tmux, where "the default is tmux" is not a claim
 * anything can make. CI installs it.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

const AGENT = fakeAgentCommand({
  banner: 'kirby-fake-agent-ready',
  bursts: 'inf',
  burstMs: 500,
  idleMs: 200,
});

test.describe('Terminal backend default (tmux detected)', () => {
  test.use({ kirbyConfig: { ...UNSET_BACKEND, aiCommand: AGENT } });

  let branches: string[] = [];
  test.beforeEach(() => {
    branches = [];
  });
  test.afterEach(({ kirby }) => {
    cleanupTmuxSessions(branches, kirby.homeDir);
  });

  test('an unconfigured Kirby runs its agents under tmux', async ({
    kirby,
  }) => {
    const branch = uniqueTmuxBranch();
    branches.push(branch);

    await createSession(kirby.term, branch);
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('kirby-fake-agent-ready').first()
    ).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(() => kirbySessionExists(branch, kirby.homeDir), {
        timeout: 10_000,
        intervals: [250],
      })
      .toBe(true);
  });

  test('Settings names tmux as the default rather than the stored value', async ({
    kirby,
  }) => {
    await kirby.term.press('s');
    await expect(kirby.term.getByText('Terminal Backend').first()).toBeVisible({
      timeout: 10_000,
    });
    // "(default)" is the part that matters: the row has to say the
    // backend was decided from the probe, not chosen by the user.
    await expect(kirby.term.getByText(/Tmux \(default\)/).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe('Terminal backend explicitly set to pty', () => {
  test.use({ kirbyConfig: { terminalBackend: 'pty', aiCommand: AGENT } });

  test('a stored "pty" survives tmux being installed', async ({ kirby }) => {
    const branch = uniqueTmuxBranch();

    await createSession(kirby.term, branch);
    await kirby.term.press('Tab');
    // The agent is genuinely running, so the absence of a tmux session
    // below means "not through tmux" rather than "not yet".
    await expect(
      kirby.term.getByText('kirby-fake-agent-ready').first()
    ).toBeVisible({ timeout: 20_000 });

    expect(kirbySessionExists(branch, kirby.homeDir)).toBe(false);
    // Nothing of Kirby's at all on this test's tmux socket — not just
    // nothing for this branch.
    expect(
      listTmuxSessions(kirby.homeDir).filter((n) => n.startsWith('kirby-'))
    ).toEqual([]);
  });
});
