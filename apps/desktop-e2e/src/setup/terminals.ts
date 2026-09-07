import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { clickAppMenuItem } from './menu.js';
import { socketEnv } from './tmux.js';

/**
 * Driving terminal tabs the way a user does — the native menu item, the
 * where-then-what dialog — plus what a test needs to assert on the tmux
 * side, all against the test's own socket.
 */

/** The "New terminal" dialog, once open. */
export function newTerminalDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({ hasText: 'New terminal' });
}

/** Open the dialog from the application menu, which is the only route
 *  that also proves the accelerator's command reaches the renderer. */
export async function openNewTerminalDialog(
  app: ElectronApplication,
  page: Page
): Promise<Locator> {
  await clickAppMenuItem(app, 'New Terminal…');
  const dialog = newTerminalDialog(page);
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return dialog;
}

/** Pick the kind and confirm. "Where" is whatever the caller chose
 *  first — the current repository is preselected. */
export async function confirmNewTerminal(
  page: Page,
  kind: 'Shell' | 'Agent'
): Promise<void> {
  const dialog = newTerminalDialog(page);
  // A choice is a radio in its step's group; its accessible name is its
  // title followed by its description.
  await dialog.getByRole('radio', { name: new RegExp(`^${kind} `) }).click();
  await dialog.getByRole('button', { name: 'Open terminal' }).click();
  await dialog.waitFor({ state: 'hidden' });
}

/** Every terminal tab on the strip. The face attribute is what the
 *  strip renders the terminal icon from. */
export function terminalTabs(page: Page): Locator {
  return page.locator('[role="tab"][data-face="terminal"]');
}

/** The tmux session names of terminal tabs on the test's server. */
export function terminalSessions(tmuxTmpdir: string): string[] {
  try {
    return execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: socketEnv(tmuxTmpdir),
    })
      .split('\n')
      .map((l) => l.trim())
      .filter((n) => n.startsWith('kirby-term-'));
  } catch {
    return [];
  }
}

/** The directory tmux holds for a session — what the app identifies a
 *  terminal by after a restart. */
export function tmuxSessionPath(name: string, tmuxTmpdir: string): string {
  return execFileSync(
    'tmux',
    ['display-message', '-p', '-t', name, '#{session_path}'],
    { encoding: 'utf8', env: socketEnv(tmuxTmpdir) }
  ).trim();
}

/**
 * Start a detached tmux session under a terminal-tab name, in `cwd`,
 * running `command` — the state a terminal tab is in after the app that
 * opened it has quit. HOME and PATH are pinned as the backend pins them.
 */
export function startSurvivingTerminal(opts: {
  name: string;
  cwd: string;
  homeDir: string;
  command: string;
}): void {
  execFileSync(
    'tmux',
    [
      'new-session',
      '-d',
      '-s',
      opts.name,
      '-c',
      opts.cwd,
      '-x',
      '120',
      '-y',
      '40',
      '-e',
      `HOME=${opts.homeDir}`,
      '-e',
      `PATH=${process.env.PATH ?? ''}`,
      '--',
      '/bin/sh',
      '-c',
      opts.command,
    ],
    { stdio: 'ignore', env: socketEnv(opts.homeDir) }
  );
}
