import { TerminalEmulator } from '@kirby/terminal';
import type { SessionBackend, SessionBackendFactory } from '@kirby/terminal';
import { createPtyBackendFactory } from '@kirby/terminal-pty';
import * as activity from './activity.js';
import { remove as removeInactiveAlert } from './inactive-alerts.js';

export interface PtyEntry {
  pty: SessionBackend;
  emu: TerminalEmulator;
  exited: boolean;
  exitCode?: number;
  /** ms-since-epoch when this entry was added to the registry. Drives
   *  the active-sessions tab bar's stable spawn-order sort. Restarting
   *  a session via `spawnSession` (which kills the old entry first)
   *  produces a fresh value, so the restarted tab moves to the end of
   *  the bar — matching browser-tab semantics. */
  spawnedAt: number;
}

const registry = new Map<string, PtyEntry>();

// Subscribers notified when an agent PTY exits on its own (Ctrl-D twice
// in claude, the agent crashing, etc.). React-side state derives the
// sidebar's "running" indicator from `isSessionAlive`, so we push a
// refresh on exit — the derived state would otherwise keep showing the
// session as running until the user next touched it. (The entry itself
// stays in the registry so its final frame remains viewable.)
const exitSubscribers = new Set<(name: string) => void>();

export function onSessionExit(cb: (name: string) => void): () => void {
  exitSubscribers.add(cb);
  return () => exitSubscribers.delete(cb);
}

let activeFactory: SessionBackendFactory = createPtyBackendFactory();

/** Swap the backend factory used by future spawnSession() calls. The
 *  composition root (apps/cli/src/session-backend.ts in Phase 4) calls
 *  this when the user picks a different terminal backend. Existing
 *  sessions in the registry are unaffected — switching is gated to
 *  empty-registry by the Settings UI guard. */
export function setSessionBackendFactory(factory: SessionBackendFactory): void {
  activeFactory = factory;
}

export function spawnSession(
  name: string,
  cmd: string,
  args: string[],
  cols: number,
  rows: number,
  cwd: string,
  env?: Record<string, string | undefined>
): PtyEntry {
  // Respawn under the same name: dispose (soft) the prior entry. On
  // tmux this detaches without killing, so the new spawn's `-A` flag
  // re-attaches to the same tmux session — preserving its scrollback.
  // On the direct PTY backend dispose === kill.
  const existing = registry.get(name);
  if (existing) {
    existing.pty.dispose();
    existing.emu.dispose();
    activity.detach(name);
    removeInactiveAlert(name);
    registry.delete(name);
  }

  const pty = activeFactory({
    name,
    cmd,
    args,
    cols,
    rows,
    cwd,
    // Merge over the current environment — never replace it, or the
    // child loses PATH/HOME/etc. `env` carries only seed additions
    // (e.g. KIRBY_SEED_PROMPT for the `continue || seed` path).
    env: env ? { ...process.env, ...env } : undefined,
  });
  const emu = new TerminalEmulator(cols, rows);
  const entry: PtyEntry = { pty, emu, exited: false, spawnedAt: Date.now() };

  pty.onData((data) => {
    void emu.write(data);
  });

  pty.onExit((code) => {
    entry.exited = true;
    entry.exitCode = code;
    // The agent exited on its own. Keep the entry in the registry: its
    // final output frame + exit code stay viewable (usePtySession
    // renders them off `entry.exited`) and the row keeps flashing
    // "unseen output". `isSessionAlive` now returns false, so the
    // sidebar running indicator flips green → gray once subscribers
    // refresh. We deliberately do NOT detach activity here — activity
    // tracks the exit via its own onExit handler, and detaching would
    // wipe the state the flash depends on. We DO drop any pending
    // inactive-alert (a session that had gone idle, was enqueued, then
    // exited shouldn't remain an Escape-jump target). Disposing
    // pty/emu and detaching activity falls to killSession or the next
    // same-name spawnSession — both of which can now still reach the
    // entry because it stays in the registry.
    if (registry.get(name) === entry) {
      removeInactiveAlert(name);
      for (const sub of [...exitSubscribers]) sub(name);
    }
  });

  activity.attach(name, pty);
  registry.set(name, entry);
  return entry;
}

export function getSession(name: string): PtyEntry | undefined {
  return registry.get(name);
}

export function hasSession(name: string): boolean {
  return registry.has(name);
}

/**
 * True only while the PTY is still running. A self-exited session stays
 * in the registry (so its final frame + exit code remain viewable), so
 * `hasSession` alone can't distinguish "present" from "alive". The
 * sidebar running indicator and any "the agent process will be killed"
 * guard derive from this.
 */
export function isSessionAlive(name: string): boolean {
  const entry = registry.get(name);
  return entry !== undefined && !entry.exited;
}

export function hasAnySession(): boolean {
  // Exited entries linger in the registry until the user removes the
  // worktree (or hits the kill-agent shortcut). Treat them as absent
  // here so the Settings backend-switch guard doesn't refuse a switch
  // just because a long-dead `claude /quit` left a tombstone behind.
  for (const entry of registry.values()) {
    if (!entry.exited) return true;
  }
  return false;
}

/** Return the spawn time (ms-since-epoch) for the named session, or
 *  undefined if no PTY entry exists. Used by the tab bar's spawn-order
 *  sort. Per-entry-immutable, so safe to read during render. */
export function getSpawnedAt(name: string): number | undefined {
  return registry.get(name)?.spawnedAt;
}

/** Explicit teardown — used when the user removes a worktree or kills
 *  a session. Calls the backend's `kill()` so persistent backends
 *  (tmux) terminate the underlying session, not just detach. */
export function killSession(name: string): void {
  const entry = registry.get(name);
  if (entry) {
    entry.pty.kill();
    entry.emu.dispose();
    activity.detach(name);
    removeInactiveAlert(name);
    registry.delete(name);
  }
}

/** Soft cleanup — used on Kirby process exit. Calls the backend's
 *  `dispose()` so tmux sessions survive and can be reattached on the
 *  next launch. For the direct PTY backend this is the same as kill().
 */
export function killAll(): void {
  for (const [name, entry] of registry.entries()) {
    entry.pty.dispose();
    entry.emu.dispose();
    activity.detach(name);
    removeInactiveAlert(name);
  }
  registry.clear();
}
