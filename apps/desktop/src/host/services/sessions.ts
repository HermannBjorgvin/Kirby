import {
  buildAgentOptions,
  buildReviewLaunchRequest,
  checkoutPlan as checkoutPlanCore,
  launchSession,
  getSession,
  killSession as killSessionEntry,
  isSessionAlive,
  resolveTerminalBackend,
  getSpawnedAt,
  noteInput,
  noteResize,
  noteSeen,
  snapshot as activitySnapshot,
} from '@kirby/core';
import { readConfig } from '@kirby/vcs-core';
import { branchToSessionName, createWorktree } from '@kirby/worktree-manager';
import { requireRepo } from './repo.js';
import type {
  AgentOptionView,
  PlanCheckoutRequest,
  PlanCheckoutResult,
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
  /** Repository this session was launched for. The PTY registry is
   *  keyed by branch name alone (it also names worktree directories, so
   *  it can't be namespaced without moving them), which means two repos
   *  sharing a branch name collide on one key. Recording the owner lets
   *  every desktop-side lookup ignore, and refuse to act on, a session
   *  belonging to a repository other than the open one. */
  repoCwd: string;
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

/**
 * Record a freshly spawned PTY and start relaying its output.
 *
 * `seq` is deliberately carried over when the name is respawned. A
 * mounted terminal remembers the sequence number its replayed snapshot
 * ended at and ignores anything at or below it, so restarting a session
 * behind a pane that is still on screen — relaunching a finished agent,
 * or restarting one with a plan — would emit chunks numbered from 1
 * again and the pane would drop every one of them. The scrollback
 * *is* reset: the new agent starts with an empty screen.
 */
function adoptSession(name: string, branch: string, repoCwd: string): void {
  const prev = known.get(name);
  const entry: KnownSession =
    prev && prev.repoCwd === repoCwd
      ? Object.assign(prev, { branch, chunks: [], bytes: 0 })
      : { branch, repoCwd, chunks: [], bytes: 0, seq: 0 };
  known.set(name, entry);
  attachRelay(name, entry);
}

// ── Known sessions ───────────────────────────────────────────────
// The pty-registry has no iteration API (the CLI enumerates via its
// own React state), so the desktop host tracks the sessions it
// launched. Entries persist after exit so the final frame stays
// viewable — matching TUI behavior.

const known = new Map<string, KnownSession>();

/** The session under `name`, but only when it belongs to the repo
 *  that's open now. Entries for other repos stay in the map (their
 *  agents are still running and are restored on switching back) but are
 *  invisible to this repo's UI and operations. */
function ownSession(name: string): KnownSession | undefined {
  const entry = known.get(name);
  if (!entry) return undefined;
  return entry.repoCwd === requireRepo() ? entry : undefined;
}

/** Names this host launched for the currently open repo. */
function ownSessionNames(): string[] {
  const cwd = requireRepo();
  return [...known.entries()]
    .filter(([, e]) => e.repoCwd === cwd)
    .map(([name]) => name);
}

/**
 * Whether a live session under `name` belongs to the open repository.
 *
 * The PTY registry is keyed by the bare branch name, so "is anything
 * running called `main`?" is the wrong question for anything user
 * facing — two repos with a `main` share the answer. Callers deciding
 * what to show, or what to stop, have to ask this instead.
 */
export function isOwnSessionAlive(name: string): boolean {
  return isSessionAlive(name) && ownSession(name) !== undefined;
}

/**
 * Stop `name`, unless it belongs to another repository — in which case
 * this repo has no agent under that name to stop (the guard in
 * `doLaunchAgent` makes a second one impossible), and killing it would
 * reach into the other repo's.
 *
 * Distinct from `killSession`, which throws: that one answers a user
 * pointing at a specific agent, where silence would be a lie. This one
 * is housekeeping inside a larger operation that is legitimate either
 * way, so it skips rather than aborting it.
 */
export function killOwnSession(name: string): void {
  if (known.has(name) && !ownSession(name)) return;
  killSessionEntry(name);
}

/** Thrown when a session name is live but owned by another repository —
 *  acting on it would reach into that repo's agent. */
function foreignSessionError(name: string): Error {
  return new Error(
    `A session named "${name}" is already running for another repository. ` +
      `Close it there before using this branch here.`
  );
}

// ── Operations ───────────────────────────────────────────────────

// Overlapping launch calls for the same session (double-click racing
// the renderer's isPending flag) must not double-spawn: the second
// spawn would dispose the first PTY and attach a duplicate data relay.
const inflightLaunches = new Map<string, Promise<{ name: string }>>();

/**
 * `knownWorktreePath` is for callers that have already been told where
 * the checkout is — discovery hands over the worktree git actually
 * reported. It is deliberately a parameter rather than a field on
 * `SessionLaunchRequest`: that type crosses the IPC bridge, and the
 * renderer has no business naming a directory to spawn an agent in.
 */
export function launchAgent(
  req: SessionLaunchRequest,
  knownWorktreePath?: string
): Promise<{
  name: string;
}> {
  requireRepo();
  const name = branchToSessionName(req.branch);
  const existing = inflightLaunches.get(name);
  if (existing) return existing;
  const promise = doLaunchAgent(req, name, knownWorktreePath).finally(() =>
    inflightLaunches.delete(name)
  );
  inflightLaunches.set(name, promise);
  return promise;
}

async function doLaunchAgent(
  req: SessionLaunchRequest,
  name: string,
  knownWorktreePath?: string
): Promise<{ name: string }> {
  const repoCwd = requireRepo();
  // TUI semantics: a live agent is never silently respawned — every
  // TUI launch site checks the registry first. Launching on a branch
  // with a running session just reattaches to it.
  if (isSessionAlive(name)) {
    // …but only if it is *this* repo's session. The registry key is the
    // bare branch name, so reattaching blindly would hand this repo's
    // tab the other repo's agent, and write keystrokes into it.
    if (!ownSession(name)) throw foreignSessionError(name);
    return { name };
  }
  // Resolve-or-create through the same primitive as every TUI launch
  // path. The worktree directory is keyed by the branch *name*, and an
  // existing directory wins even if a different branch has since been
  // checked out inside it — resolving via listWorktrees (actual
  // checked-out branches) instead made the desktop reject worktrees
  // the TUI happily launched in.
  // `createWorktree` resolves the directory from the branch *name*, so
  // it cannot find a worktree someone put somewhere else —
  // `git worktree add .claude/worktrees/foo -b my/branch` is exactly
  // what the operator-at-a-shell case looks like, and resolving it by
  // name would try to add a second checkout of a branch that is already
  // out and fail. A caller that was handed the real path skips the
  // guess.
  const wtPath = knownWorktreePath ?? (await createWorktree(req.branch));
  if (!wtPath) {
    throw new Error(`Failed to resolve a worktree for "${req.branch}"`);
  }
  // Config comes from the repo root, like the TUI — per-project config
  // is keyed by cwd hash, so reading from the worktree path resolved a
  // different (empty) project bag.
  // A per-launch agent pick from the session menu overrides the
  // configured one; the resolver still owns the id → agent mapping.
  const stored = readConfig(repoCwd);
  const config = req.agentId ? { ...stored, agentId: req.agentId } : stored;
  console.log(
    `[desktop] launching session ${name} in ${wtPath} (backend: ${resolveTerminalBackend(
      config
    )})`
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
  adoptSession(name, req.branch, repoCwd);
  return { name };
}

/**
 * The session menu's agent picker: the configured agent first (the
 * launch you get without touching the picker), then the rest of the
 * registry. Same list, same order, same labels as the TUI.
 */
export function listAgentOptions(): AgentOptionView[] {
  const config = readConfig(requireRepo());
  return buildAgentOptions(config).map((o) => ({
    id: o.agent.id,
    name: o.name,
  }));
}

export function getSessionBuffer(name: string): SessionBuffer {
  const entry = ownSession(name);
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

// Double-sends land here the way double-clicks land on launch: the
// renderer disables the button while a send is in flight, but the
// second click can beat the state update. Joining the in-flight
// promise makes the second one a no-op instead of a second spawn.
// (A checkout racing a plain launch of the same branch is not
// serialized — the loser's PTY is disposed by the winner's spawn,
// which is the same outcome as two launches racing.)
const inflightCheckouts = new Map<string, Promise<PlanCheckoutResult>>();

/**
 * Send a composed plan to the agent for `req.pr`.
 *
 * The three-state decision — inject into a live agent, respawn it, or
 * create the worktree and start one — lives in @kirby/core and is
 * shared with the TUI. What the desktop adds is its own bookkeeping:
 * the ownership guard, and adopting whatever PTY comes out so its
 * output reaches the renderer.
 */
export function checkoutPlan(
  req: PlanCheckoutRequest
): Promise<PlanCheckoutResult> {
  const repoCwd = requireRepo();
  const name = branchToSessionName(req.pr.sourceBranch);
  // Never inject into, or restart, an agent belonging to a repository
  // other than the open one — the registry is keyed by bare branch
  // name, so the names collide (see KnownSession.repoCwd).
  if (known.has(name) && !ownSession(name)) throw foreignSessionError(name);
  const existing = inflightCheckouts.get(name);
  if (existing) return existing;
  const promise = doCheckoutPlan(req, name, repoCwd).finally(() =>
    inflightCheckouts.delete(name)
  );
  inflightCheckouts.set(name, promise);
  return promise;
}

async function doCheckoutPlan(
  req: PlanCheckoutRequest,
  name: string,
  repoCwd: string
): Promise<PlanCheckoutResult> {
  const config = readConfig(repoCwd);
  // core reports failures by flashing a status line, which the TUI has
  // and the host does not. Capture the message and reject with it: the
  // renderer toasts it and leaves the plan intact for a retry.
  let failure: string | null = null;
  const result = await checkoutPlanCore({
    pr: req.pr,
    prompt: req.prompt,
    paneCols: clampDim(req.cols, DEFAULT_COLS),
    paneRows: clampDim(req.rows, DEFAULT_ROWS),
    mode: req.mode,
    config,
    flashStatus: (msg) => {
      failure ??= msg;
    },
  });
  if (result === 'failed') {
    throw new Error(failure ?? 'Could not send the plan to the agent');
  }
  if (result === 'spawned') adoptSession(name, req.pr.sourceBranch, repoCwd);
  return result;
}

function clampDim(value: number | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value) || value < 2) return fallback;
  return Math.min(500, Math.floor(value));
}

export function listSessions(): SessionSummary[] {
  return ownSessionNames().map((name) => ({
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
  for (const name of ownSessionNames()) {
    out[name] = activitySnapshot(name);
  }
  return out;
}

export function markSessionSeen(name: string): void {
  noteSeen(name);
}

export function killSession(name: string): void {
  // Never reach into another repository's agent (see KnownSession.repoCwd).
  // A name this host has never launched is left to the registry, which
  // no-ops when it doesn't know it either.
  if (known.has(name) && !ownSession(name)) throw foreignSessionError(name);
  killSessionEntry(name);
}
