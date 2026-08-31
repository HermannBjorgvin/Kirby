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
  type TmuxStatus,
} from '@kirby/terminal-tmux';
import type { AppConfig } from '@kirby/vcs-core';
import { projectKey } from '@kirby/vcs-core';
import { setSessionBackendFactory } from './pty-registry.js';

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
      sessionPrefix: `kirby-${projectKey(repoRoot)}-`,
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

/** The tmux session name the backend would use for a registry session
 *  name — the same composition buildSessionBackendFactory bakes into
 *  its prefix. */
function tmuxNameFor(sessionName: string, repoRoot: string): string {
  return sanitizeTmuxSessionName(
    `kirby-${projectKey(repoRoot)}-${sessionName}`
  );
}

/** True when a tmux session for this registry name survived a previous
 *  run (dispose-on-quit leaves tmux sessions running by design). Used
 *  to reattach at startup. Never throws; false when tmux/repoRoot is
 *  out of the picture. */
export function isTmuxSessionPersisted(
  config: Pick<AppConfig, 'terminalBackend'>,
  sessionName: string
): boolean {
  if (resolveTerminalBackend(config) !== 'tmux') return false;
  if (cachedTmuxStatus && !cachedTmuxStatus.available) return false;
  const root = getRepoRoot();
  if (!root) return false;
  try {
    return tmuxHasSession(tmuxNameFor(sessionName, root));
  } catch {
    return false;
  }
}

/** Kill the persisted tmux session for a registry name, whether or not
 *  the registry knows about it — an explicit worktree removal must not
 *  leave a live tmux session working in a deleted directory. */
export function killPersistedTmuxSession(
  config: Pick<AppConfig, 'terminalBackend'>,
  sessionName: string
): void {
  if (resolveTerminalBackend(config) !== 'tmux') return;
  const root = getRepoRoot();
  if (!root) return;
  try {
    tmuxKillSession(tmuxNameFor(sessionName, root));
  } catch {
    // no server / no session — nothing to kill
  }
}
