import {
  buildReviewLaunchRequest,
  launchSession,
  getSession,
  killSession as killSessionEntry,
  isSessionAlive,
  getSpawnedAt,
  noteInput,
  noteResize,
  noteSeen,
  snapshot as activitySnapshot,
} from '@kirby/app-core';
import { readConfig } from '@kirby/vcs-core';
import { branchToSessionName, createWorktree } from '@kirby/worktree-manager';
import { requireRepo } from './repo.js';
import type {
  ReviewLaunchRequest,
  SessionBuffer,
  SessionLaunchRequest,
  SessionSummary,
} from '../contract.js';

export type { SessionLaunchRequest, SessionSummary };

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 40;
/** Per-session scrollback kept for late/remounting terminals. */
const BUFFER_LIMIT = 512 * 1024;

// ── Event streaming (main → renderer) ────────────────────────────

let broadcast: ((channel: string, payload: unknown) => void) | null = null;

/** Called from main.ts once windows exist; forwards PTY output and
 *  exit notices to every renderer window. */
export function setSessionBroadcaster(
  fn: (channel: string, payload: unknown) => void
): void {
  broadcast = fn;
}

interface KnownSession {
  branch: string;
  /** Ring buffer of recent output chunks (bounded by BUFFER_LIMIT). */
  chunks: string[];
  bytes: number;
  seq: number;
}

function attachRelay(name: string, entry: KnownSession): void {
  const session = getSession(name);
  if (!session) throw new Error(`Session ${name} vanished after spawn`);
  session.pty.onData((data) => {
    entry.seq += 1;
    entry.chunks.push(data);
    entry.bytes += data.length;
    while (entry.bytes > BUFFER_LIMIT && entry.chunks.length > 1) {
      entry.bytes -= entry.chunks.shift()?.length ?? 0;
    }
    broadcast?.('kirby/session/data', { name, data, seq: entry.seq });
  });
  session.pty.onExit((code) => {
    console.log(`[desktop] session ${name} exited with code ${code}`);
    broadcast?.('kirby/session/exit', { name, code });
  });
}

// ── Known sessions ───────────────────────────────────────────────
// The pty-registry has no iteration API (the CLI enumerates via its
// own React state), so the desktop host tracks the sessions it
// launched. Entries persist after exit so the final frame stays
// viewable — matching TUI behavior.

const known = new Map<string, KnownSession>();

// ── Operations ───────────────────────────────────────────────────

// Overlapping launch calls for the same session (double-click racing
// the renderer's isPending flag) must not double-spawn: the second
// spawn would dispose the first PTY and attach a duplicate data relay.
const inflightLaunches = new Map<string, Promise<{ name: string }>>();

export function launchAgent(req: SessionLaunchRequest): Promise<{
  name: string;
}> {
  requireRepo();
  const name = branchToSessionName(req.branch);
  const existing = inflightLaunches.get(name);
  if (existing) return existing;
  const promise = doLaunchAgent(req, name).finally(() =>
    inflightLaunches.delete(name)
  );
  inflightLaunches.set(name, promise);
  return promise;
}

async function doLaunchAgent(
  req: SessionLaunchRequest,
  name: string
): Promise<{ name: string }> {
  const repoCwd = requireRepo();
  // TUI semantics: a live agent is never silently respawned — every
  // TUI launch site checks the registry first. Launching on a branch
  // with a running session just reattaches to it.
  if (isSessionAlive(name)) {
    return { name };
  }
  // Resolve-or-create through the same primitive as every TUI launch
  // path. The worktree directory is keyed by the branch *name*, and an
  // existing directory wins even if a different branch has since been
  // checked out inside it — resolving via listWorktrees (actual
  // checked-out branches) instead made the desktop reject worktrees
  // the TUI happily launched in.
  const wtPath = await createWorktree(req.branch);
  if (!wtPath) {
    throw new Error(`Failed to resolve a worktree for "${req.branch}"`);
  }
  // Config comes from the repo root, like the TUI — per-project config
  // is keyed by cwd hash, so reading from the worktree path resolved a
  // different (empty) project bag.
  const config = readConfig(repoCwd);
  console.log(
    `[desktop] launching session ${name} in ${wtPath} (backend: ${
      config.terminalBackend ?? 'pty'
    })`
  );
  launchSession({
    name,
    cwd: wtPath,
    cols: clampDim(req.cols, DEFAULT_COLS),
    rows: clampDim(req.rows, DEFAULT_ROWS),
    config,
    request: {
      intent: req.intent,
      prompt: req.prompt,
      systemGuidance: req.systemGuidance,
    },
  });
  const entry: KnownSession = {
    branch: req.branch,
    chunks: [],
    bytes: 0,
    seq: 0,
  };
  known.set(name, entry);
  attachRelay(name, entry);
  return { name };
}

export function getSessionBuffer(name: string): SessionBuffer {
  const entry = known.get(name);
  if (!entry) return { data: '', seq: 0 };
  return { data: entry.chunks.join(''), seq: entry.seq };
}

/**
 * Start (or resume) an AI review of `req.pr` with the shared review
 * prompt. Same flow as the TUI's "Start/Continue review" menu entry —
 * launchAgent resolves or creates the worktree.
 */
export async function launchReviewAgent(req: ReviewLaunchRequest): Promise<{
  name: string;
}> {
  requireRepo();
  const branch = req.pr.sourceBranch;
  const request = buildReviewLaunchRequest(req.pr, req.instruction);
  return launchAgent({
    branch,
    intent: request.intent,
    prompt: request.prompt,
    systemGuidance: request.systemGuidance,
    cols: req.cols,
    rows: req.rows,
  });
}

function clampDim(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value) || value < 2) return fallback;
  return Math.min(500, Math.floor(value));
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
  // Same as the TUI's input forwarder: without this, the terminal
  // echoing keystrokes back would count as agent activity.
  noteInput(name);
  entry.pty.write(data);
}

export function resizeSession(name: string, cols: number, rows: number): void {
  const entry = getSession(name);
  if (!entry || entry.exited) return;
  // SIGWINCH redraws aren't agent activity either.
  noteResize(name);
  entry.pty.resize(cols, rows);
}

/** Debounced agent-activity snapshots for every session this host has
 *  launched — the same registry the TUI's sidebar spinner reads. */
export function getSessionActivity(): Record<
  string,
  ReturnType<typeof activitySnapshot>
> {
  const out: Record<string, ReturnType<typeof activitySnapshot>> = {};
  for (const name of known.keys()) {
    out[name] = activitySnapshot(name);
  }
  return out;
}

export function markSessionSeen(name: string): void {
  noteSeen(name);
}

export function killSession(name: string): void {
  killSessionEntry(name);
}
