import {
  launchSession,
  getSession,
  killSession as killSessionEntry,
  isSessionAlive,
  getSpawnedAt,
  type LaunchIntent,
} from '@kirby/app-core';
import { readConfig } from '@kirby/vcs-core';
import { branchToSessionName, listWorktrees } from '@kirby/worktree-manager';
import { requireRepo } from './repo.js';

export interface SessionLaunchRequest {
  branch: string;
  intent: LaunchIntent;
  prompt?: string;
}

export interface SessionSummary {
  name: string;
  running: boolean;
  spawnedAt: number;
}

// ── Event streaming (main → renderer) ────────────────────────────

let broadcast: ((channel: string, payload: unknown) => void) | null = null;

/** Called from main.ts once windows exist; forwards PTY output and
 *  exit notices to every renderer window. */
export function setSessionBroadcaster(
  fn: (channel: string, payload: unknown) => void
): void {
  broadcast = fn;
}

function attachRelay(name: string): void {
  const entry = getSession(name);
  if (!entry) throw new Error(`Session ${name} vanished after spawn`);
  entry.pty.onData((data) => {
    broadcast?.('kirby/session/data', { name, data });
  });
  entry.pty.onExit((code) => {
    broadcast?.('kirby/session/exit', { name, code });
  });
}

// ── Known sessions ───────────────────────────────────────────────
// The pty-registry has no iteration API (the CLI enumerates via its
// own React state), so the desktop host tracks the sessions it
// launched. Entries persist after exit so the final frame stays
// viewable — matching TUI behavior.

const known = new Map<string, { branch: string }>();

// ── Operations ───────────────────────────────────────────────────

export async function launchAgent(req: SessionLaunchRequest): Promise<{
  name: string;
}> {
  requireRepo();
  const wt = (await listWorktrees()).find((w) => w.branch === req.branch);
  if (!wt) {
    throw new Error(`No worktree exists for branch "${req.branch}"`);
  }
  const config = readConfig(wt.path);
  const name = branchToSessionName(req.branch);
  launchSession({
    name,
    cwd: wt.path,
    cols: 80,
    rows: 24,
    config,
    request: { intent: req.intent, prompt: req.prompt },
  });
  known.set(name, { branch: req.branch });
  attachRelay(name);
  return { name };
}

export function listSessions(): SessionSummary[] {
  requireRepo();
  return [...known.keys()].map((name) => ({
    name,
    running: isSessionAlive(name),
    spawnedAt: getSpawnedAt(name) ?? 0,
  }));
}

export function writeSession(name: string, data: string): void {
  const entry = getSession(name);
  if (!entry || entry.exited) throw new Error(`Session ${name} is not running`);
  entry.pty.write(data);
}

export function resizeSession(name: string, cols: number, rows: number): void {
  const entry = getSession(name);
  if (!entry || entry.exited) return;
  entry.pty.resize(cols, rows);
}

export function killSession(name: string): void {
  killSessionEntry(name);
}
