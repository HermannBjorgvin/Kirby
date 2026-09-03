/**
 * Composition root for the session backend.
 *
 * This is the only place that knows about both backends, the
 * `kirby-` session-name prefix, and the project hash used to
 * disambiguate sessions across repos. Every Kirby-specific naming
 * decision lives here — the backend libs (`@kirby/terminal-pty`,
 * `@kirby/terminal-tmux`) are deliberately ignorant of all of it.
 */
import { execFileSync } from 'node:child_process';
import type { SessionBackendFactory } from '@kirby/terminal';
import { createPtyBackendFactory } from '@kirby/terminal-pty';
import {
  createTmuxBackendFactory,
  isTmuxAvailable,
  sanitizeTmuxSessionName,
  tmuxHasSession,
  tmuxKillSession,
  tmuxListSessionsDetailed,
  type TmuxSessionInfo,
  type TmuxStatus,
} from '@kirby/terminal-tmux';
import type { AppConfig } from '@kirby/vcs-core';
import { projectKey, readProjectConfig } from '@kirby/vcs-core';
import type { DiscoveredTerminal } from './discovery/discovery-model.js';
import { liveSessionNames, setSessionBackendFactory } from './pty-registry.js';
import {
  isQualifiedTmuxName,
  parseTerminalSessionName,
} from './terminal/terminal-name.js';
import { KIRBY_TMUX_PREFIX } from './tmux-namespace.js';

/** Resolve the git toplevel of the repo Kirby is running in, or `null`
 *  when there isn't one (launched outside a working tree, `git` missing
 *  from PATH). Cached on first call — including the `null` — because
 *  the TUI is anchored to one repo for its whole process.
 *
 *  The desktop is not: it can open another repository in place, and
 *  must call {@link resetRepoRoot} when it does. Everything derived
 *  from this value namespaces tmux sessions by repo
 *  (`kirby-<projectKey(root)>-<branch>`), so a stale root makes two
 *  repos that share a branch name resolve to the *same* tmux session —
 *  attaching to, and killing, the other repo's live agent.
 *
 *  git's stderr is swallowed rather than inherited: a bare "fatal: not
 *  a git repository" written straight to the terminal would land in the
 *  middle of Ink's frame and corrupt the render. */
let cachedRepoRoot: string | null = null;
let repoRootResolved = false;

/** Drop the memoized repo root so the next {@link getRepoRoot} re-runs
 *  `git rev-parse` against the current working directory. Call after
 *  changing which repository the process is pointed at. */
export function resetRepoRoot(): void {
  cachedRepoRoot = null;
  repoRootResolved = false;
}

export function getRepoRoot(): string | null {
  if (repoRootResolved) return cachedRepoRoot;
  repoRootResolved = true;
  try {
    cachedRepoRoot =
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || null;
  } catch {
    cachedRepoRoot = null;
  }
  return cachedRepoRoot;
}

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
 *  choice, or tmux-when-detected. The kirby-`<projectKey>-` prefix is
 *  baked in here — neither backend lib knows about it.
 *
 *  Two fallbacks keep tmux from becoming a hard failure:
 *
 *  - Probe says tmux is unavailable → PTY. Without this, a config saved
 *    on a machine that has since lost tmux would explode at first
 *    session-spawn with ENOENT. The Settings UI already shows
 *    "Tmux (not installed)" so the user can re-pick. (An unset config
 *    never reaches here asking for tmux, since the default is derived
 *    from the same probe — this covers the explicit `"tmux"` case.)
 *  - No `repoRoot` → PTY. The tmux session name is namespaced by the
 *    repo's projectKey so sessions from different repos stay distinct
 *    and a restart reattaches to the right one. With no repo to key on
 *    there is nothing stable to derive that from, and cwd is the wrong
 *    substitute — launching from a subdirectory would hash differently
 *    and silently strand the previous session. */
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
    return createTmuxBackendFactory({
      sessionPrefix: tmuxPrefixFor(repoRoot),
      // Terminal-tab sessions (and orphaned worktree sessions being
      // resumed) arrive under their full tmux name.
      isQualified: isQualifiedTmuxName,
    });
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

/** The namespace every tmux session for this repo lives in. The one
 *  place the `kirby-` literal is composed; `buildSessionBackendFactory`
 *  hands it to the backend as its prefix and everything that has to
 *  recognise one of our sessions later derives from the same call.
 *
 *  Sanitization leaves it alone (hex and dashes only), so a live
 *  session name can be tested against it with `startsWith` even though
 *  the full name it was built from may have been rewritten. */
function tmuxPrefixFor(repoRoot: string): string {
  return `${KIRBY_TMUX_PREFIX}${projectKey(repoRoot)}-`;
}

/** The tmux session name the backend would use for a registry session
 *  name — the same composition buildSessionBackendFactory bakes into
 *  its prefix, and the same exemption for names that are complete
 *  already. */
function tmuxNameFor(sessionName: string, repoRoot: string): string {
  return sanitizeTmuxSessionName(
    isQualifiedTmuxName(sessionName)
      ? sessionName
      : tmuxPrefixFor(repoRoot) + sessionName
  );
}

/** The prefix in force right now, or `null` when tmux is out of the
 *  picture — the backend in force is not tmux, the probe says tmux is
 *  missing, or there is no repo root to key the namespace on. Callers
 *  treat `null` as "this process owns no tmux sessions".
 *
 *  Resolved through {@link resolveTerminalBackend}, not read off the
 *  config: with tmux the detected default, a user who never chose one
 *  is on tmux, and reading the raw field would report every one of
 *  their sessions as absent. */
function activeTmuxPrefix(
  config: Pick<AppConfig, 'terminalBackend'>
): string | null {
  if (resolveTerminalBackend(config) !== 'tmux') return null;
  const root = getRepoRoot();
  return root ? tmuxPrefixFor(root) : null;
}

/** What one `tmux list-sessions` fork says about the sessions Kirby
 *  cares about. */
export interface TmuxObservation {
  /** The subset of the asked-about worktree session names that have a
   *  live tmux session under this repository's prefix. */
  persisted: Set<string>;
  /** Every terminal-tab session on the server, whatever directory or
   *  repository it belongs to, plus this repository's orphaned worktree
   *  sessions — see {@link observeTmuxSessions}. */
  terminals: DiscoveredTerminal[];
}

const NOTHING: TmuxObservation = { persisted: new Set(), terminals: [] };

/**
 * One fork, two answers: which worktree sessions survived, and which
 * terminal sessions exist.
 *
 * Worktree isolation falls out of the name rather than being enforced
 * on top of it: a candidate is composed through the same prefix and
 * sanitizer the backend spawned with, and only an exact match counts.
 * Another checkout's agents carry that checkout's hash and a session
 * the user started for their own reasons carries no prefix at all, so
 * neither can be matched by construction.
 *
 * Terminal sessions are the opposite: they are found by *name shape*
 * (`kirby-term-<kind>-<id>`) and reported wherever they run, because a
 * terminal belongs to its directory, not to the repository this scan
 * happens to be for — one opened in another checkout still has to come
 * back as a tab. Its directory is tmux's own `session_path`; nothing
 * is written to disk to remember it.
 *
 * A session under this repository's prefix that no worktree answers to
 * is an orphan — an agent that checked out another branch inside its
 * worktree renames what the scan looks for, not the session — and is
 * reported as an agent terminal in its directory, so it surfaces as a
 * tab instead of running on invisibly. But only when nothing here
 * already holds it: the PTY registry keys a worktree session by the
 * *branch it was spawned under*, which is exactly what a mid-session
 * checkout leaves stale, so a candidate is checked against every live
 * registry entry's own composed tmux name — not just the current
 * worktree list — before it is offered as adoptable. Skipping that
 * check is how the orphan path attaches a second client to a session
 * this process is already driving. Never throws; an absent tmux server
 * yields nothing, same as no sessions.
 */
export function observeTmuxSessions(
  config: Pick<AppConfig, 'terminalBackend'>,
  sessionNames: readonly string[]
): TmuxObservation {
  if (resolveTerminalBackend(config) !== 'tmux') return NOTHING;
  let live: TmuxSessionInfo[];
  try {
    live = tmuxListSessionsDetailed();
  } catch {
    return NOTHING;
  }
  const prefix = activeTmuxPrefix(config);
  const root = prefix ? getRepoRoot() : null;
  const composed = new Map(
    prefix
      ? sessionNames.map((n) => [sanitizeTmuxSessionName(prefix + n), n])
      : []
  );
  const owned = new Set(
    root ? liveSessionNames().map((n) => tmuxNameFor(n, root)) : []
  );
  const persisted = new Set<string>();
  const terminals: DiscoveredTerminal[] = [];
  for (const { name, path } of live) {
    const term = parseTerminalSessionName(name);
    if (term) {
      terminals.push({ name, kind: term.kind, path });
      continue;
    }
    if (!prefix || !name.startsWith(prefix)) continue;
    const registryName = composed.get(name);
    if (registryName !== undefined) persisted.add(registryName);
    else if (!owned.has(name)) terminals.push({ name, kind: 'agent', path });
  }
  return { persisted, terminals };
}

/**
 * Which of `sessionNames` currently have a live tmux session belonging
 * to this repository — the worktree half of {@link observeTmuxSessions},
 * for callers with no terminal tabs (the TUI).
 */
export function listPersistedTmuxSessions(
  config: Pick<AppConfig, 'terminalBackend'>,
  sessionNames: readonly string[]
): Set<string> {
  return observeTmuxSessions(config, sessionNames).persisted;
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
 *  from under it. Callers that need the *preference* want
 *  {@link isTmuxSessionPersisted}.
 *
 *  Never throws; false when tmux or the repo root is out of the
 *  picture, since without either there is no session to find. */
export function hasLiveTmuxSession(sessionName: string): boolean {
  if (cachedTmuxStatus && !cachedTmuxStatus.available) return false;
  const root = getRepoRoot();
  if (!root) return false;
  try {
    return tmuxHasSession(tmuxNameFor(sessionName, root));
  } catch {
    return false;
  }
}

/** True when a tmux session for this registry name survived a previous
 *  run (dispose-on-quit leaves tmux sessions running by design) *and*
 *  tmux is the backend in force. Used to decide whether to reattach at
 *  startup, where the preference is the point: reattaching under the
 *  PTY backend would spawn a second, unrelated agent in the same
 *  worktree rather than resuming the one that is running.
 *
 *  For "does a tmux session exist at all" — safety checks, teardown —
 *  use {@link hasLiveTmuxSession}. */
export function isTmuxSessionPersisted(
  config: Pick<AppConfig, 'terminalBackend'>,
  sessionName: string
): boolean {
  if (resolveTerminalBackend(config) !== 'tmux') return false;
  return hasLiveTmuxSession(sessionName);
}

/** Kill the persisted tmux session for a registry name, whether or not
 *  the registry knows about it — an explicit worktree removal must not
 *  leave a live tmux session working in a deleted directory.
 *
 *  Deliberately not gated on the selected backend. The session's
 *  existence is what matters, and gating on the preference is how a
 *  session created under the tmux default becomes unkillable the moment
 *  the user picks PTY: removing its worktree would then delete the
 *  directory and leave the agent running in it forever. Killing a
 *  session that is not there is already a no-op. */
export function killPersistedTmuxSession(sessionName: string): void {
  const root = getRepoRoot();
  if (!root) return;
  try {
    tmuxKillSession(tmuxNameFor(sessionName, root));
  } catch {
    // no server / no session — nothing to kill
  }
}
