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
}

const registry = new Map<string, PtyEntry>();

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
  cwd: string
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

  const pty = activeFactory({ name, cmd, args, cols, rows, cwd });
  const emu = new TerminalEmulator(cols, rows);
  const entry: PtyEntry = { pty, emu, exited: false };

  pty.onData((data) => {
    void emu.write(data);
  });

  pty.onExit((code) => {
    entry.exited = true;
    entry.exitCode = code;
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
