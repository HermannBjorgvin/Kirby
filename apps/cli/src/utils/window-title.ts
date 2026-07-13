/**
 * Terminal window/tab title.
 *
 * Ink has no window-title API — the title is an OSC escape sequence
 * written straight to stdout, outside of Ink's frame. It draws nothing,
 * so it can't collide with Ink's diffed output.
 */
import { execFileSync } from 'node:child_process';
import { basename, dirname } from 'node:path';

const setTitle = (title: string) => `\x1b]2;${title}\x07`;

// XTWINOPS: push the current title onto the terminal's own title stack,
// pop it back on quit. Terminals without a title stack ignore both and
// simply keep the title Kirby set.
const PUSH_TITLE = '\x1b[22;2t';
const POP_TITLE = '\x1b[23;2t';

let pushed = false;

/**
 * Name of the repo Kirby is driving.
 *
 * Resolved from the *common* git dir, so a Kirby launched from inside
 * one of its own worktrees still titles the tab with the parent repo
 * rather than the session directory.
 */
export function repoTitle(cwd: string = process.cwd()): string {
  try {
    const commonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (commonDir) return basename(dirname(commonDir));
  } catch {
    // Not a git repo, or git predates --path-format (2.31).
  }
  return basename(cwd);
}

/** Control characters would terminate the OSC string early. */
function sanitize(title: string): string {
  // eslint-disable-next-line no-control-regex
  return title.replace(/[\x00-\x1f\x7f]/g, '');
}

export function setWindowTitle(title: string): void {
  const clean = sanitize(title);
  if (!process.stdout.isTTY || !clean) return;

  if (!pushed) {
    process.stdout.write(PUSH_TITLE);
    pushed = true;
  }
  process.stdout.write(setTitle(clean));
}

/** Hand the tab back the title it had before Kirby started. */
export function restoreWindowTitle(): void {
  if (!pushed) return;
  pushed = false;
  process.stdout.write(POP_TITLE);
}
