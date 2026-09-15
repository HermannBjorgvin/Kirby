/**
 * Composition root for the session backend.
 *
 * This is the only place that knows about both backends and the repo
 * root the tmux identity rules are keyed to. Every Kirby-specific
 * decision about a tmux session — what it is, what it is called, what
 * it is tagged with — is composed here from `session-identity.ts`,
 * `session-resolver.ts` and `tmux-factory-options.ts`; the backend
 * libs (`@kirby/terminal-pty`, `@kirby/terminal-tmux`) are deliberately
 * ignorant of all of it.
 */
import { terminalSessionKey, sessionIdentity } from './session-key.js';
import { getRepoRoot } from './repo-root.js';
import { basename } from 'node:path';
import type { SessionBackendFactory } from '@kirby/terminal';
import { createPtyBackendFactory } from '@kirby/terminal-pty';
import {
  createTmuxBackendFactory,
  isTmuxAvailable,
  tmuxKillSession,
  type TmuxStatus,
} from '@kirby/terminal-tmux';
import type { AppConfig } from '@kirby/vcs-core';
import { readProjectConfig } from '@kirby/vcs-core';
import type {
  DiscoveredTerminal,
  DiscoveredWorktree,
} from './discovery/discovery-model.js';
import { liveSessionNames, setSessionBackendFactory } from './pty-registry.js';
import {
  isTerminalSession,
  registryNameOf,
  type TaggedSession,
} from './session-identity.js';
import {
  listOurSessions,
  resolveRegistrySession,
  resolveSessionByName,
} from './session-resolver.js';
import { kirbyTmuxFactoryOptions } from './tmux-factory-options.js';

export { getRepoRoot, resetRepoRoot } from './repo-root.js';

// ── Tmux availability cache ─────────────────────────────────────
//
// The Settings UI guard runs synchronously inside an Ink input
// handler, so it can't await a Promise. We probe tmux once at
// startup and stash the result here for the handler to read.

let cachedTmuxStatus: TmuxStatus | null = null;

/** Run the tmux availability probe and cache the result. Call once
 *  at startup. Subsequent calls re-await the same memoized
 *  Promise from `@kirby/terminal-tmux`'s `isTmuxAvailable()`. */
export async function probeTmuxAvailability(): Promise<void> {
  cachedTmuxStatus = await isTmuxAvailable();
}

/** Synchronously read the cached tmux status. Returns `null` if the
 *  probe hasn't completed yet (extremely unlikely after the first
 *  render — startup awaits it). */
export function getTmuxAvailability(): TmuxStatus | null {
  return cachedTmuxStatus;
}

/** The backend a config that says nothing lands on: tmux wherever the
 *  probe found a usable tmux, PTY otherwise.
 *
 *  Deliberately *not* written back to `~/.kirby/config.json`. The
 *  choice is re-derived every launch, so installing tmux starts
 *  persisting sessions and removing it stops — and a config file synced
 *  between machines cannot pin one machine's tmux onto another that
 *  hasn't got it. A probe that hasn't answered yet reads as "no tmux",
 *  which is the safe direction: PTY works everywhere. */
export function defaultTerminalBackend(
  status: TmuxStatus | null = cachedTmuxStatus
): 'pty' | 'tmux' {
  return status?.available ? 'tmux' : 'pty';
}

/** The backend actually in force: what the user stored, or
 *  {@link defaultTerminalBackend} when they never said.
 *
 *  An explicit value always wins, in both directions — `'pty'` is
 *  honoured forever on a machine that has tmux, and `'tmux'` behaves
 *  exactly as it always has (with the availability and repo-root
 *  degradations in {@link buildSessionBackendFactory} still applying). */
export function resolveTerminalBackend(
  config: Pick<AppConfig, 'terminalBackend'>,
  status: TmuxStatus | null = cachedTmuxStatus
): 'pty' | 'tmux' {
  return config.terminalBackend ?? defaultTerminalBackend(status);
}

/** The backend this project pins by hand, if any.
 *
 *  `readConfig` gives the per-project value precedence over the global
 *  one, but the Settings row writes the *global* key — so with an
 *  override in place a change would appear to save and then revert on
 *  the next read, and in the meantime this run would use the value the
 *  user picked while the next run used the project's. Both shells ask
 *  this and refuse the edit instead, naming the reason. Never throws:
 *  an unreadable project config is simply no override. */
export function projectTerminalBackendOverride(
  cwd: string
): 'pty' | 'tmux' | undefined {
  try {
    return readProjectConfig(cwd).terminalBackend;
  } catch {
    return undefined;
  }
}

/** Application policy: build a SessionBackendFactory configured for
 *  the backend {@link resolveTerminalBackend} lands on — the user's
 *  choice, or tmux-when-detected. The tmux identity rules
 *  ({@link kirbyTmuxFactoryOptions}) are keyed to the repo root here;
 *  neither backend lib knows about them.
 *
 *  Two fallbacks keep tmux from becoming a hard failure:
 *
 *  - Probe says tmux is unavailable → PTY. Without this, a config saved
 *    on a machine that has since lost tmux would explode at first
 *    session-spawn with ENOENT. The Settings UI already shows
 *    "Tmux (not installed)" so the user can re-pick. (An unset config
 *    never reaches here asking for tmux, since the default is derived
 *    from the same probe — this covers the explicit `"tmux"` case.)
 *  - No `repoRoot` → PTY. A tmux session is identified by its
 *    repository, so without one there is nothing to tag it with or
 *    find it by, and cwd is the wrong substitute — launching from a
 *    subdirectory would answer differently and strand the previous
 *    session. */
export function buildSessionBackendFactory(
  config: AppConfig,
  repoRoot: string | null
): SessionBackendFactory {
  if (resolveTerminalBackend(config) === 'tmux') {
    if (!repoRoot) {
      return createPtyBackendFactory();
    }
    if (cachedTmuxStatus && !cachedTmuxStatus.available) {
      return createPtyBackendFactory();
    }
    return createTmuxBackendFactory(kirbyTmuxFactoryOptions(repoRoot));
  }
  return createPtyBackendFactory();
}

/** Apply the resolved factory to the registry. Call this on startup
 *  and from the settings write path whenever `config.terminalBackend`
 *  changes (which both shells gate to empty-registry).
 *
 *  Resolves `repoRoot` only when the resolved backend is tmux, so a PTY
 *  machine doesn't pay a `git rev-parse` fork on every boot. Callers sit
 *  on paths where a throw would take startup or an input handler down,
 *  so the lookup never throws — outside a working tree it yields `null`
 *  and tmux degrades to PTY. */
export function applySessionBackend(config: AppConfig): void {
  const repoRoot =
    resolveTerminalBackend(config) === 'tmux' ? getRepoRoot() : null;
  const factory = buildSessionBackendFactory(config, repoRoot);
  setSessionBackendFactory(factory);
}

/** What one `tmux list-sessions` fork says about the sessions Kirby
 *  cares about. */
export interface TmuxObservation {
  /** The registry names of the asked-about worktrees that have a live
   *  tmux session tagged with this repository and their branch. */
  persisted: Set<string>;
  /** Every terminal-tab session on the server, whatever directory or
   *  repository it belongs to, plus this repository's orphaned worktree
   *  sessions — see {@link observeTmuxSessions}. */
  terminals: DiscoveredTerminal[];
}

const NOTHING: TmuxObservation = { persisted: new Set(), terminals: [] };

/** The branch a worktree's session is tagged with: the branch, or the
 *  directory's name on a detached HEAD — the same fallback the HEAD
 *  reader and `worktreeSessionName` use. */
function worktreeBranch(wt: DiscoveredWorktree): string {
  return wt.branch || basename(wt.path);
}

/**
 * One fork, two answers: which worktree sessions survived, and which
 * terminal sessions exist.
 *
 * Every session is read through the resolver, so only tagged sessions
 * are seen at all: a session whose name Kirby might have chosen but
 * that carries no tags is foreign and never listed. A worktree session
 * is this repository's when its `@orchestra-repo` is the open root;
 * it is *persisted* when one of the worktrees handed in is on the
 * branch it is tagged with. Another checkout's sessions carry that
 * checkout's root and are left alone.
 *
 * Terminal sessions are found by session type and reported wherever
 * they run, because a terminal belongs to its directory, not to the
 * repository this scan happens to be for — one opened in another
 * checkout still has to come back as a tab. Its directory is tmux's
 * own `session_path`; nothing is written to disk to remember it.
 *
 * A worktree session tagged with this repository whose branch no
 * worktree answers to is an orphan — an agent that checked out another
 * branch inside its worktree changes what the scan looks for, not the
 * session — and is reported as an agent terminal in its directory, so
 * it surfaces as a tab instead of running on invisibly. But only when
 * nothing here already holds it: the PTY registry keys a worktree
 * session by the branch it was spawned under, which is exactly what a
 * mid-session checkout leaves stale, so a session is checked against
 * every live registry entry's key before it is offered as adoptable.
 * Skipping that check is how the orphan path attaches a second client
 * to a session this process is already driving. Never throws; an
 * absent tmux server yields nothing, same as no sessions.
 */
export function observeTmuxSessions(
  config: Pick<AppConfig, 'terminalBackend'>,
  worktrees: readonly DiscoveredWorktree[]
): TmuxObservation {
  if (resolveTerminalBackend(config) !== 'tmux') return NOTHING;
  const root = getRepoRoot();
  if (!root) return NOTHING;
  const ctx: ClassifyContext = {
    root,
    byBranch: new Map(worktrees.map((wt) => [worktreeBranch(wt), wt.name])),
    owned: new Set(liveSessionNames()),
  };
  const persisted = new Set<string>();
  const terminals: DiscoveredTerminal[] = [];
  for (const session of listOurSessions()) {
    const found = classifySession(session, ctx);
    if (!found) continue;
    if (found.kind === 'terminal') terminals.push(found.terminal);
    else persisted.add(found.name);
  }
  return { persisted, terminals };
}

interface ClassifyContext {
  /** The open repository's root — what `@orchestra-repo` must equal. */
  root: string;
  /** Tagged branch → the registry name of the worktree on it. */
  byBranch: Map<string, string>;
  /** Registry keys of every session this process already holds — see
   *  {@link liveSessionNames}. */
  owned: Set<string>;
}

/** What one of our live tmux sessions means to this repository: a
 *  worktree session that survived (`persisted`), a terminal tab to
 *  report (`terminal`), or nothing (`null`) — another repository's
 *  session, or one already owned that would otherwise read as an
 *  orphan. A terminal tab needs somewhere to run and display, so a
 *  session tmux reports no path for is dropped rather than reported
 *  onto no path at all; a persisted worktree session needs no path. */
function classifySession(
  session: TaggedSession,
  ctx: ClassifyContext
):
  | { kind: 'terminal'; terminal: DiscoveredTerminal }
  | { kind: 'persisted'; name: string }
  | null {
  const { name, path } = session;
  if (isTerminalSession(session)) {
    return path
      ? {
          kind: 'terminal',
          terminal: {
            name: terminalSessionKey(name),
            kind: session.type,
            path,
          },
        }
      : null;
  }
  if (session.repo !== ctx.root) return null;
  const registryName = ctx.byBranch.get(session.branch);
  if (registryName !== undefined)
    return { kind: 'persisted', name: registryName };
  if (ctx.owned.has(registryNameOf(session)) || !path) return null;
  return {
    kind: 'terminal',
    terminal: { name: terminalSessionKey(name), kind: 'agent', path },
  };
}

/** The tmux session a registry name stands for in the open
 *  repository, verified by its tags, or `null` — outside a working
 *  tree there is nothing to tag a session with, so nothing to find. */
function resolveOwn(sessionName: string): TaggedSession | null {
  const identity = sessionIdentity(sessionName);
  return identity?.kind === 'worktree'
    ? resolveRegistrySession(identity.repo, sessionName)
    : null;
}

/** True when a tmux session for this registry name exists right now,
 *  *whatever backend is currently selected*.
 *
 *  A tmux session outlives the preference that created it: quitting
 *  only detaches, so one created under the tmux default is still there
 *  after the user picks PTY, after tmux drops off `PATH`, and after a
 *  probe that answers differently than it did last run. Asking "should
 *  we be using tmux?" instead of "is there a tmux session?" is how a
 *  live agent becomes invisible — and then gets its worktree swept out
 *  from under it. Callers that hold a tmux *name* rather than a
 *  registry key want {@link hasLiveTmuxSessionNamed}.
 *
 *  Never throws; false when tmux or the repo root is out of the
 *  picture, since without either there is no session to find. */
export function hasLiveTmuxSession(sessionName: string): boolean {
  if (cachedTmuxStatus && !cachedTmuxStatus.available) return false;
  return resolveOwn(sessionName) !== null;
}

/** Resolve a qualified terminal key to its exact tagged tmux target, across
 *  repositories. Adopted orphan worktrees also use terminal keys. */
export function hasLiveTmuxSessionNamed(name: string): boolean {
  if (cachedTmuxStatus && !cachedTmuxStatus.available) return false;
  const identity = sessionIdentity(name);
  return (
    identity?.kind === 'terminal' && resolveSessionByName(identity.id) !== null
  );
}

/** {@link hasLiveTmuxSessionNamed} *and* tmux is the backend in force —
 *  the reattach decision for a terminal tab whose client exited: with
 *  tmux in force the session is still there and the tab reattaches;
 *  under PTY there is nothing to reattach to and the tab has ended.
 *  The preference is the point: reattaching under the PTY backend
 *  would spawn a second, unrelated process rather than resume the one
 *  that is running. */
export function isTmuxSessionNamedPersisted(
  config: Pick<AppConfig, 'terminalBackend'>,
  name: string
): boolean {
  if (resolveTerminalBackend(config) !== 'tmux') return false;
  return hasLiveTmuxSessionNamed(name);
}

/** Kill the persisted tmux session for a registry name, whether or not
 *  the registry knows about it — an explicit worktree removal must not
 *  leave a live tmux session working in a deleted directory.
 *
 *  Deliberately not gated on the selected backend. The session's
 *  existence is what matters, and gating on the preference is how a
 *  session created under the tmux default becomes unkillable the moment
 *  the user picks PTY: removing its worktree would then delete the
 *  directory and leave the agent running in it forever. The session is
 *  found through the resolver, so its tags are verified before
 *  `kill-session`: a session that merely carries the name Kirby would
 *  have chosen, without the tags, is someone else's and is not
 *  touched. Nothing to kill is a no-op. */
export function killPersistedTmuxSession(sessionName: string): void {
  const session = resolveOwn(sessionName);
  if (!session) return;
  try {
    tmuxKillSession(session.name);
  } catch {
    // no server / no session — nothing to kill
  }
}
