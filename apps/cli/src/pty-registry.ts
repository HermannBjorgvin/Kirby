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
// sidebar's "running" indicator from `isSessionAlive`, so we push a
// refresh on exit — the derived state would otherwise keep showing the
// session as running until the user next touched it. (The entry itself
// stays in the registry so its final frame remains viewable.)
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
