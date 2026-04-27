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
import type { AppConfig } from '@kirby/vcs-core';
import { projectKey } from '@kirby/vcs-core';
import { setSessionBackendFactory } from './pty-registry.js';

/** Resolve the git toplevel of the repo Kirby is running in. Cached on
 *  first call — Kirby is anchored to one repo per process. */
let cachedRepoRoot: string | null = null;
export function getRepoRoot(): string {
  if (cachedRepoRoot) return cachedRepoRoot;
  cachedRepoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
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
 *  Startup fallback: if the user's saved config requests tmux but the
 *  cached probe says tmux is unavailable, silently fall back to PTY.
 *  Without this, a config saved on a machine that has since lost tmux
 *  would explode at first session-spawn with ENOENT. The Settings UI
 *  already shows "Tmux (not installed)" so the user can re-pick. */
export function buildSessionBackendFactory(
  config: AppConfig,
  repoRoot: string
): SessionBackendFactory {
  if (config.terminalBackend === 'tmux') {
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
 *  Resolves `repoRoot` lazily so the default PTY backend doesn't pay
 *  a `git rev-parse` fork on every boot — and, more importantly,
 *  doesn't throw an unhandled error from inside `useEffect` when
 *  Kirby is launched outside a git working tree. */
export function applySessionBackend(config: AppConfig): void {
  const repoRoot = config.terminalBackend === 'tmux' ? getRepoRoot() : '';
  const factory = buildSessionBackendFactory(config, repoRoot);
  setSessionBackendFactory(factory);
}
