import { PtySession, TerminalEmulator } from '@kirby/terminal';
import * as activity from './activity.js';
import { remove as removeInactiveAlert } from './inactive-alerts.js';

export interface PtyEntry {
  pty: PtySession;
  emu: TerminalEmulator;
  exited: boolean;
  exitCode?: number;
}

const registry = new Map<string, PtyEntry>();

// Subscribers notified when an agent PTY exits on its own (Ctrl-D twice
// in claude, the agent crashing, etc.). React-side state derives the
// sidebar's "running" indicator from `hasSession`, so we need to push a
// refresh — the registry would otherwise still report the dead session
// as alive until the user touches it.
const exitSubscribers = new Set<(name: string) => void>();

export function onSessionExit(cb: (name: string) => void): () => void {
  exitSubscribers.add(cb);
  return () => exitSubscribers.delete(cb);
}

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
  const entry: PtyEntry = { pty, emu, exited: false };

  pty.onData((data) => {
    void emu.write(data);
  });

  pty.onExit((code) => {
    entry.exited = true;
    entry.exitCode = code;
    // The agent died. Drop it from the registry so `hasSession` stops
    // reporting it as alive, then notify subscribers so React state can
    // refresh and flip the sidebar indicator from green to gray. We
    // intentionally leave `emu` alive here — usePtySession may still
    // hold a ref and render a final "process exited" frame; disposing
    // it now would crash that render. Cleanup falls to killSession or
    // the next spawnSession with the same name.
    if (registry.get(name) === entry) {
      activity.detach(name);
      removeInactiveAlert(name);
      registry.delete(name);
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
