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
 *  from PATH). Cached on first call — including the `null` — since
 *  Kirby is anchored to one repo per process.
 *
 *  git's stderr is swallowed rather than inherited: a bare "fatal: not
 *  a git repository" written straight to the terminal would land in the
 *  middle of Ink's frame and corrupt the render. */
let cachedRepoRoot: string | null = null;
let repoRootResolved = false;
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

/** Application policy: build a SessionBackendFactory configured for
 *  the user's chosen backend. The kirby-`<projectKey>-` prefix is
 *  baked in here — neither backend lib knows about it.
 *
 *  Two fallbacks keep a tmux selection from becoming a hard failure:
 *
 *  - Probe says tmux is unavailable → PTY. Without this, a config saved
 *    on a machine that has since lost tmux would explode at first
 *    session-spawn with ENOENT. The Settings UI already shows
 *    "Tmux (not installed)" so the user can re-pick.
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
  if (config.terminalBackend === 'tmux') {
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
 *  and whenever `config.terminalBackend` changes (which the Settings
 *  UI gates to empty-registry).
 *
 *  Resolves `repoRoot` lazily so the default PTY backend doesn't pay a
 *  `git rev-parse` fork on every boot. This runs inside a `useEffect`,
 *  where a throw would surface as an unhandled error and take the
 *  render down, so the lookup never throws — outside a working tree it
 *  yields `null` and the tmux selection degrades to PTY. */
export function applySessionBackend(config: AppConfig): void {
  const repoRoot = config.terminalBackend === 'tmux' ? getRepoRoot() : null;
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
  if (config.terminalBackend !== 'tmux') return false;
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
  if (config.terminalBackend !== 'tmux') return;
  const root = getRepoRoot();
  if (!root) return;
  try {
    tmuxKillSession(tmuxNameFor(sessionName, root));
  } catch {
    // no server / no session — nothing to kill
  }
}
