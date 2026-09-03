/**
 * Terminal tabs: sessions that belong to a directory rather than to a
 * worktree, so the user never has to leave Kirby for a plain terminal.
 *
 * Split from `contract.ts` because it is one subject, and because that
 * file is a catalogue already.
 */

export type TerminalKind = 'shell' | 'agent';

export interface TerminalLaunchRequest {
  kind: TerminalKind;
  /** Absolute directory to open the terminal in. Any directory. */
  cwd: string;
  /** Initial PTY size — the renderer knows the pane geometry. */
  cols?: number;
  rows?: number;
}

/**
 * One terminal the host holds, as the renderer sees it.
 *
 * `repo` is where the tab belongs: the directory itself when it is a
 * repository root, `null` for any other directory — a folder outside
 * git, or a folder *inside* a checkout, which is deliberately not
 * walked up to its root. Derived at read time from the directory, so a
 * terminal restored from tmux is grouped the same way one just opened
 * is.
 */
export interface TerminalSummary {
  /** Session name, `kirby-term-<kind>-<id>` — also the tmux name. */
  name: string;
  kind: TerminalKind;
  cwd: string;
  /** `cwd` with the home directory written as `~`, for the tab. */
  displayPath: string;
  repo: string | null;
  running: boolean;
  spawnedAt: number;
}
