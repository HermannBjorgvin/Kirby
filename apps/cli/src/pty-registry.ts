import { PtySession, TerminalEmulator } from '@kirby/terminal';
import * as activity from './activity.js';
import { remove as removeInactiveAlert } from './inactive-alerts.js';

export interface PtyEntry {
  pty: PtySession;
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

export function spawnSession(
  name: string,
  cmd: string,
  args: string[],
  cols: number,
  rows: number,
  cwd: string
): PtyEntry {
  // Kill existing session with same name if any
  const existing = registry.get(name);
  if (existing) {
    existing.pty.dispose();
    existing.emu.dispose();
    activity.detach(name);
    removeInactiveAlert(name);
    registry.delete(name);
  }

  const pty = new PtySession(cmd, args, { cols, rows, cwd });
  const emu = new TerminalEmulator(cols, rows);
  const entry: PtyEntry = { pty, emu, exited: false, spawnedAt: Date.now() };

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

/** Return the spawn time (ms-since-epoch) for the named session, or
 *  undefined if no PTY entry exists. Used by the tab bar's spawn-order
 *  sort. Per-entry-immutable, so safe to read during render. */
export function getSpawnedAt(name: string): number | undefined {
  return registry.get(name)?.spawnedAt;
}

export function killSession(name: string): void {
  const entry = registry.get(name);
  if (entry) {
    entry.pty.dispose();
    entry.emu.dispose();
    activity.detach(name);
    removeInactiveAlert(name);
    registry.delete(name);
  }
}

/** Kill all PTY sessions. Called on process exit to prevent orphaned children. */
export function killAll(): void {
  for (const [name, entry] of registry.entries()) {
    entry.pty.dispose();
    entry.emu.dispose();
    activity.detach(name);
    removeInactiveAlert(name);
  }
  registry.clear();
}
