/**
 * Host-side ownership of external-session discovery.
 *
 * The scanning, the diffing and the decision about what may be attached
 * to all live in `@kirby/core`; what the desktop adds is the same thing
 * it adds to every other launch — its own bookkeeping (`launchAgent`
 * records the session and starts the output relay) and a push to the
 * renderer, which serves its sidebar from a query cache and would
 * otherwise wait out its poll interval.
 */
import {
  startSessionDiscovery,
  type DiscoveredWorktree,
  type SessionDiscovery,
} from '@kirby/core';
import { readConfig } from '@kirby/vcs-core';
import { activeRepoIs } from './repo.js';
import { launchAgent } from './sessions.js';

let discovery: SessionDiscovery | null = null;

// Installed by main.ts. Fires when discovery changed what
// getSidebarModel() would answer.
let changed: (() => void) | null = null;

export function setDiscoveryNotifier(fn: (() => void) | null): void {
  changed = fn;
}

async function attach(worktree: DiscoveredWorktree): Promise<void> {
  // The desktop's launch path is keyed by branch all the way down —
  // the worktree it resolves, the registry name, the tab. A
  // detached-HEAD orphan has no branch to key on, so it is left to the
  // TUI, which names sessions after the directory instead. Thrown
  // rather than skipped so the scanner stops offering it every tick.
  if (!worktree.branch) {
    throw new Error(
      `Cannot attach to ${worktree.name}: the worktree has no branch checked out`
    );
  }
  await launchAgent({ branch: worktree.branch, intent: 'continue-or-blank' });
}

/**
 * Begin discovery for a repository, replacing any previous run.
 *
 * Called on every repo open. The `isCurrent` guard is what keeps a scan
 * that started before a repo switch from finishing against the new one:
 * `launchAgent` would take this repo's branch names and happily create
 * them over there.
 */
export function startDiscoveryForRepo(cwd: string): void {
  stopDiscovery();
  discovery = startSessionDiscovery({
    getConfig: () => readConfig(cwd),
    isCurrent: () => activeRepoIs(cwd),
    adopt: attach,
    onChanged: () => changed?.(),
  });
}

/** Stop discovery. Idempotent; safe to call with none running. */
export function stopDiscovery(): void {
  discovery?.stop();
  discovery = null;
}
