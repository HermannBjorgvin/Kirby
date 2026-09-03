import { homedir } from 'node:os';
import {
  getSpawnedAt,
  isSessionAlive,
  killSession as killSessionEntry,
  launchTerminalSession,
  newTerminalSessionName,
  type DiscoveredTerminal,
} from '@kirby/core';
import { readConfig } from '@kirby/vcs-core';
import type {
  SessionBuffer,
  TerminalKind,
  TerminalLaunchRequest,
  TerminalSummary,
} from '../contract.js';
import { ensureRecent } from './recent-repos.js';
import { isGitRepo } from './repo.js';
import {
  attachRelay,
  newRelayEntry,
  relayBuffer,
  type RelayEntry,
} from './session-relay.js';
import { displayPath, terminalRepo } from './terminal-home.js';

/**
 * Terminal tabs, host side.
 *
 * A terminal is a session bound to a directory: a shell or an agent,
 * opened wherever the user asked for it. Unlike a worktree session it
 * belongs to no repository *by construction* — which repository it is
 * shown under is derived from its directory every time it is listed,
 * and a terminal in another checkout, or in no checkout at all, is
 * still this user's terminal whatever repository is open. So nothing
 * here goes through `requireRepo`.
 *
 * There is no state file. The name carries the kind, tmux carries the
 * directory (`session_path`), and discovery hands both back after a
 * restart through {@link adoptTerminal}.
 */

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;

interface KnownTerminal extends RelayEntry {
  kind: TerminalKind;
  cwd: string;
}

const known = new Map<string, KnownTerminal>();

function clampDim(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value) || value < 2) return fallback;
  return Math.min(500, Math.floor(value));
}

function start(
  name: string,
  kind: TerminalKind,
  cwd: string,
  size: { cols?: number; rows?: number }
): void {
  // Config for the directory, not for whatever repository is open: an
  // agent at a repository root should be that repository's agent.
  launchTerminalSession({
    name,
    kind,
    cwd,
    cols: clampDim(size.cols, DEFAULT_COLS),
    rows: clampDim(size.rows, DEFAULT_ROWS),
    config: readConfig(cwd),
  });
  const prev = known.get(name);
  const entry: KnownTerminal = {
    ...newRelayEntry(prev?.seq ?? 0),
    kind,
    cwd,
  };
  known.set(name, entry);
  attachRelay(name, entry);
}

/** A repository root the user reached through a terminal goes on the
 *  repo list, so the tab's repository can be opened like any other. */
function noteRepository(cwd: string): string | null {
  const repo = terminalRepo(cwd, isGitRepo);
  if (repo) ensureRecent(repo);
  return repo;
}

function summarize(name: string, entry: KnownTerminal, home: string) {
  return {
    name,
    kind: entry.kind,
    cwd: entry.cwd,
    displayPath: displayPath(entry.cwd, home),
    repo: terminalRepo(entry.cwd, isGitRepo),
    running: isSessionAlive(name),
    spawnedAt: getSpawnedAt(name) ?? 0,
  };
}

/** Open a new terminal. `home` is injectable for tests. */
export function launchTerminal(
  req: TerminalLaunchRequest,
  home: string = homedir()
): TerminalSummary {
  const name = newTerminalSessionName(req.kind);
  start(name, req.kind, req.cwd, req);
  noteRepository(req.cwd);
  const entry = known.get(name);
  if (!entry) throw new Error(`Terminal ${name} vanished after launch`);
  return summarize(name, entry, home);
}

/** Reattach to a terminal discovery found in tmux — the restore path,
 *  and the mid-run one. The name and directory are tmux's. */
export function adoptTerminal(
  terminal: DiscoveredTerminal,
  home: string = homedir()
): void {
  start(terminal.name, terminal.kind, terminal.path, {});
  noteRepository(terminal.path);
  void home;
}

export function listTerminals(home: string = homedir()): TerminalSummary[] {
  return [...known.entries()].map(([name, entry]) =>
    summarize(name, entry, home)
  );
}

/** Kill the session — on tmux, `kill-session`; on PTY, the process —
 *  and forget the terminal. A name never launched here is nothing. */
export function killTerminal(name: string): void {
  if (!known.has(name)) return;
  killSessionEntry(name);
  known.delete(name);
}

export function isTerminal(name: string): boolean {
  return known.has(name);
}

export function terminalNames(): string[] {
  return [...known.keys()];
}

export function terminalBuffer(name: string): SessionBuffer | undefined {
  const entry = known.get(name);
  return entry ? relayBuffer(entry) : undefined;
}
