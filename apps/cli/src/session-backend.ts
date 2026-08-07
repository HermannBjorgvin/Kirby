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
  type TmuxStatus,
} from '@kirby/terminal-tmux';
import {
  createBeamBackendFactory,
  isBeamAvailable,
  type BeamStatus,
} from '@kirby/terminal-beam';
import type { AppConfig } from '@kirby/vcs-core';
import { projectKey } from '@kirby/vcs-core';
import {
  setSessionBackendFactory,
  setSessionBackendResolver,
} from './pty-registry.js';
import {
  createBeamWorkspaces,
  pendingBranchFor,
} from './session/beam-workspaces.js';
import { localWorkspaces, setSessionWorkspaces } from './session/workspaces.js';

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

// ── Beam availability cache ─────────────────────────────────────
//
// Same shape as the tmux probe: once at startup, synchronous reads
// for input handlers and the session-creation choice.

let cachedBeamStatus: BeamStatus | null = null;

export async function probeBeamAvailability(): Promise<void> {
  cachedBeamStatus = await isBeamAvailable();
}

export function getBeamAvailability(): BeamStatus | null {
  return cachedBeamStatus;
}

/**
 * The beam host sessions can be created on, when everything lines up:
 * both project config fields are set, the beam CLI is installed, and
 * the configured host is actually registered with beam. Null otherwise
 * — and with null, session creation never shows the choice.
 */
export function availableBeamHost(config: AppConfig): string | null {
  const host = config.beamHost;
  if (!host || !config.beamRepoPath) return null;
  if (!cachedBeamStatus?.available) return null;
  if (!cachedBeamStatus.remotes.includes(host)) return null;
  return host;
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
  const wantsBeam = Boolean(config.beamHost && config.beamRepoPath);
  const repoRoot =
    config.terminalBackend === 'tmux' || wantsBeam ? getRepoRoot() : null;
  const factory = buildSessionBackendFactory(config, repoRoot);
  setSessionBackendFactory(factory);

  // Sessions on a beam host: their keys are `<host>:<name>`, and the
  // key alone routes them to the beam factory and the beam workspace.
  // The host worktree namespace reuses the tmux prefix so two Kirby
  // projects sharing one host stay distinct.
  const host = config.beamHost;
  const repoPath = config.beamRepoPath;
  if (host && repoPath && repoRoot) {
    const prefix = `kirby-${projectKey(repoRoot)}-`;
    const beamFactory = createBeamBackendFactory({
      sessionPrefix: prefix,
      branchFor: pendingBranchFor,
      repoFor: (name) => (pendingBranchFor(name) ? repoPath : undefined),
    });
    setSessionBackendResolver((name) =>
      name.startsWith(`${host}:`) ? beamFactory : factory
    );
    setSessionWorkspaces([
      localWorkspaces,
      createBeamWorkspaces(host, repoPath, prefix),
    ]);
  } else {
    setSessionBackendResolver(() => factory);
    setSessionWorkspaces([localWorkspaces]);
  }
}
