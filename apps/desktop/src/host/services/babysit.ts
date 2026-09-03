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
import { readConfig } from '@kirby/vcs-core';
import { activeRepoIs, requireRepo } from './repo.js';
import { adoptSpawnedSession, defaultPaneSize } from './sessions.js';
import { findPullRequest, repoProvider } from './sidebar.js';

interface Sitter {
  handle: PrBabysitter;
  sourceBranch: string;
}

/** cwd → pull request id → its babysitter. */
const sitters = new Map<string, Map<number, Sitter>>();

// Installed by main.ts. Fires when a status the renderer may be
// showing has moved.
let changed: (() => void) | null = null;

export function setBabysitNotifier(fn: (() => void) | null): void {
  changed = fn;
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
  const pr = await findPullRequest(cwd, prId);
  if (!pr) throw new Error(`Pull request #${prId} is not in the sidebar`);
  const handle = startPrBabysitter({
    pr,
    provider: repoProvider(cwd),
    getConfig: () => readConfig(cwd),
    readPullRequest: () => findPullRequest(cwd, prId),
    paneSize: defaultPaneSize,
    onSpawned: (name) => adoptSpawnedSession(name, pr.sourceBranch),
    onStatus: (status) => {
      // A babysitter that ended (the pull request merged or closed)
      // leaves the list, so the row stops offering to stop it.
      if (status.phase === 'ended') forRepo(cwd).delete(prId);
      changed?.();
    },
    isCurrent: () => activeRepoIs(cwd),
  });
  forRepo(cwd).set(prId, { handle, sourceBranch: pr.sourceBranch });
  changed?.();
  return handle.status();
}

/** Stop babysitting. Nothing to stop is not an error. */
export function stopBabysit(prId: number): void {
  const byId = forRepo(requireRepo());
  const sitter = byId.get(prId);
  if (!sitter) return;
  sitter.handle.stop();
  byId.delete(prId);
  changed?.();
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
