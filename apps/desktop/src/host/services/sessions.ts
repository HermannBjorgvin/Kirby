import {
  buildReviewLaunchRequest,
  launchSession,
  getSession,
  killSession as killSessionEntry,
  isSessionAlive,
  getSpawnedAt,
} from '@kirby/app-core';
import { readConfig } from '@kirby/vcs-core';
import {
  branchToSessionName,
  createWorktree,
  listWorktrees,
} from '@kirby/worktree-manager';
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
 * Start (or resume) an AI review of `req.pr`: make sure the PR's branch
 * has a worktree, then launch with the shared review prompt. Same flow
 * as the TUI's "Start/Continue review" menu entry.
 */
export async function launchReviewAgent(req: ReviewLaunchRequest): Promise<{
  name: string;
}> {
  requireRepo();
  const branch = req.pr.sourceBranch;
  const existing = (await listWorktrees()).find((w) => w.branch === branch);
  if (!existing) {
    const created = await createWorktree(branch);
    if (!created) throw new Error(`Failed to create worktree for ${branch}`);
  }
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
