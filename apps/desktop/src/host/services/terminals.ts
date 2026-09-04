import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute } from 'node:path';
import {
  getSession,
  getSpawnedAt,
  isSessionAlive,
  killSession as killSessionEntry,
  launchTerminalSession,
  newTerminalSessionName,
  releaseExitedSession,
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

/**
 * Reject a directory a terminal cannot actually launch into, before it
 * reaches either backend. Without this an invalid `cwd` (a relative
 * path — the chooser only ever hands over absolute ones, but the host
 * is the boundary that must not trust that — or one that does not
 * exist) surfaces as an opaque `posix_spawnp failed` from node-pty or a
 * tmux client that exits the instant it starts, neither of which names
 * the actual problem.
 */
function assertLaunchableCwd(cwd: string): void {
  if (!isAbsolute(cwd)) {
    throw new Error(`Terminal directory must be an absolute path: ${cwd}`);
  }
  let isDir: boolean;
  try {
    isDir = statSync(cwd).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    throw new Error(`Terminal directory does not exist: ${cwd}`);
  }
}

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
  watchForEnd(name, entry);
  attachRelay(name, entry);
}

/**
 * A terminal is over when its process ends — `exit` typed into the
 * shell, the agent quitting, or on tmux the session ending under the
 * client, whether its last process exited or someone killed it from
 * outside. The terminal is then dropped from the listing, which is what
 * closes its tab, and everything held for it is released.
 *
 * Subscribed before the relay so the listing is already without the
 * terminal when the renderer hears the exit and asks. Identity guards
 * both ends: a kill or a respawn under the same name deletes or
 * replaces the registry entry before the old client's exit lands, and
 * that exit must not drop what replaced it — nor, on quit, does the
 * client that `killAll` detached find anything left to drop.
 */
function watchForEnd(name: string, entry: KnownTerminal): void {
  const session = getSession(name);
  if (!session) throw new Error(`Terminal ${name} vanished after launch`);
  session.pty.onExit(() => {
    if (getSession(name) !== session || known.get(name) !== entry) return;
    known.delete(name);
    releaseExitedSession(name);
  });
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
  assertLaunchableCwd(req.cwd);
  const name = newTerminalSessionName(req.kind);
  start(name, req.kind, req.cwd, req);
  noteRepository(req.cwd);
  const entry = known.get(name);
  if (!entry) throw new Error(`Terminal ${name} ended during launch`);
  return summarize(name, entry, home);
}

/** Reattach to a terminal discovery found in tmux — the restore path,
 *  and the mid-run one. The name and directory are tmux's. */
export function adoptTerminal(terminal: DiscoveredTerminal): void {
  start(terminal.name, terminal.kind, terminal.path, {});
  noteRepository(terminal.path);
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

/** Terminal names of the `agent` kind only — a shell running whatever
 *  the user types (`ls`, a build) is not agent activity, and must not
 *  animate its tab with the working-agent spinner the way a real agent
 *  does. */
export function agentTerminalNames(): string[] {
  return [...known.entries()]
    .filter(([, entry]) => entry.kind === 'agent')
    .map(([name]) => name);
}

export function terminalBuffer(name: string): SessionBuffer | undefined {
  const entry = known.get(name);
  return entry ? relayBuffer(entry) : undefined;
}
