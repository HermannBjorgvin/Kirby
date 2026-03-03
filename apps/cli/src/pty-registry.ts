import { PtySession, TerminalEmulator } from '@kirby/tmux-control';

export interface PtyEntry {
  pty: PtySession;
  emu: TerminalEmulator;
  exited: boolean;
  exitCode?: number;
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
    registry.delete(name);
  }

  const pty = new PtySession(cmd, args, { cols, rows, cwd });
  const emu = new TerminalEmulator(cols, rows);
  const entry: PtyEntry = { pty, emu, exited: false };

  pty.onData((data) => {
    emu.write(data);
  });

  pty.onExit((code) => {
    entry.exited = true;
    entry.exitCode = code;
  });

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
    registry.delete(name);
  }
}

export function listSessionNames(): string[] {
  return [...registry.keys()];
}
