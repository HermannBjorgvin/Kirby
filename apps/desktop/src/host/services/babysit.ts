/**
 * Host-side ownership of pull request babysitters.
 *
 * What to watch, what counts as news and when to tell the agent all
 * live in `@kirby/core`; what the desktop adds is the same thing it
 * adds to every other launch — adopting a session core spawned so its
 * output reaches the renderer — plus a push to the renderer, whose
 * sidebar reads babysit status from a query cache.
 *
 * Babysitters are kept per repository, because the tab strip spans
 * repositories and switching back and forth is normal: one for a repo
 * that is not open sits out its ticks (`isCurrent`) rather than being
 * torn down, so switching away and back does not lose what the agent
 * has already been told. They are in memory only — a restart starts
 * from nothing, and so does the first update after it.
 */
import {
  startPrBabysitter,
  type BabysitStatus,
  type PrBabysitter,
} from '@kirby/core';
import type { BabysitChangedEvent } from '../contract.js';
import { readConfig } from '@kirby/vcs-core';
import { activeRepoIs, requireRepo } from './repo.js';
import {
  adoptSpawnedSession,
  defaultPaneSize,
  isForeignSession,
} from './sessions.js';
import { lookupPullRequest, repoProvider } from './pull-requests.js';

interface Sitter {
  handle: PrBabysitter;
  sourceBranch: string;
}

/** cwd → pull request id → its babysitter. */
const sitters = new Map<string, Map<number, Sitter>>();

// Installed by main.ts. Fires when a status the renderer may be
// showing has moved.
let changed: ((event: BabysitChangedEvent) => void) | null = null;

export function setBabysitNotifier(
  fn: ((event: BabysitChangedEvent) => void) | null
): void {
  changed = fn;
}

/**
 * The cadence, overridable from the environment so a test can watch a
 * delivery happen in seconds rather than the ten minutes a reviewer
 * gets to finish typing. Unset means core's defaults.
 */
function timingFromEnv(): {
  intervalMs?: number;
  timing?: { debounceMs?: number; maxWaitMs?: number };
} {
  const read = (name: string): number | undefined => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const debounceMs = read('KIRBY_BABYSIT_DEBOUNCE_MS');
  return {
    intervalMs: read('KIRBY_BABYSIT_POLL_MS'),
    timing: debounceMs === undefined ? undefined : { debounceMs },
  };
}

function forRepo(cwd: string): Map<number, Sitter> {
  let byId = sitters.get(cwd);
  if (!byId) {
    byId = new Map();
    sitters.set(cwd, byId);
  }
  return byId;
}

/**
 * Start babysitting a pull request of the open repository. Starting
 * one that is already babysat is a no-op that answers with its status,
 * so a double click cannot stand up two watchers on one agent.
 */
export async function startBabysit(prId: number): Promise<BabysitStatus> {
  const cwd = requireRepo();
  const existing = forRepo(cwd).get(prId);
  if (existing) return existing.handle.status();
  const lookup = await lookupPullRequest(cwd, prId);
  if (lookup.kind !== 'found') {
    throw new Error(`Pull request #${prId} is not in the sidebar`);
  }
  const { pr } = lookup;
  const handle = startPrBabysitter({
    pr,
    cwd,
    provider: repoProvider(cwd),
    getConfig: () => readConfig(cwd),
    readPullRequest: () => lookupPullRequest(cwd, prId),
    paneSize: defaultPaneSize,
    onSpawned: (name) => adoptSpawnedSession(name, pr.sourceBranch),
    isForeignSession,
    onStatus: (status) => {
      // A babysitter that ended (the pull request merged or closed)
      // leaves the list, so the row stops offering to stop it — and
      // the renderer is told which one, since the row it was on is
      // usually gone with it.
      if (status.phase === 'ended') {
        forRepo(cwd).delete(prId);
        changed?.({ ended: { prId, sourceBranch: pr.sourceBranch } });
        return;
      }
      changed?.({});
    },
    isCurrent: () => activeRepoIs(cwd),
    ...timingFromEnv(),
  });
  forRepo(cwd).set(prId, { handle, sourceBranch: pr.sourceBranch });
  changed?.({});
  return handle.status();
}

/** Stop babysitting. Nothing to stop is not an error. */
export function stopBabysit(prId: number): void {
  const byId = forRepo(requireRepo());
  const sitter = byId.get(prId);
  if (!sitter) return;
  sitter.handle.stop();
  byId.delete(prId);
  changed?.({});
}

/** The babysitters of the open repository. */
export function listBabysat(): BabysitStatus[] {
  return [...forRepo(requireRepo()).values()].map((s) => s.handle.status());
}

/** Every babysitter of every repository. For app exit. */
export function stopAllBabysitters(): void {
  for (const byId of sitters.values()) {
    for (const sitter of byId.values()) sitter.handle.stop();
  }
  sitters.clear();
}
