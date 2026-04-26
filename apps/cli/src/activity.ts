// Tracks per-session "agent activity" derived from PTY output. Owns
// every rule about what counts as activity, what counts as input echo,
// when a session needs the user's attention, etc. The pty-registry
// only calls attach/detach at the lifecycle boundary; everything else
// (the React hook, the input forwarder) talks to this module by name.

import type { PtySession } from '@kirby/terminal';
import {
  ACTIVITY_IDLE_MS,
  INPUT_ECHO_MS,
  MIN_ACTIVE_MS,
  MIN_DATA_BYTES,
} from './activity-config.js';

interface SessionActivity {
  exited: boolean;
  /** Last PTY output we attributed to the agent (not echo, not noise),
   * or null if the session has not produced qualifying output yet. */
  lastDataAt: number | null;
  /** Last keystroke we forwarded to the PTY. */
  lastInputAt: number;
  /** Start of the current active streak, or null when idle. */
  activeSince: number | null;
  /** Wall time the user last viewed this session. */
  lastSeenAt: number;
  /** Cleanup for the onData/onExit subscriptions we own. */
  dispose: () => void;
}

const sessions = new Map<string, SessionActivity>();

export function attach(name: string, pty: PtySession): void {
  detach(name);

  const state: SessionActivity = {
    exited: false,
    // null = "session has never produced qualifying output". Seeding
    // with `Date.now()` made every freshly-attached session look active
    // for the first ACTIVITY_IDLE_MS.
    lastDataAt: null,
    // -Infinity so any data at t=0 is outside the echo window. Using 0
    // would have suppressed the first emit when Date.now() happened to
    // read 0 (fake timers in tests; never in real life).
    lastInputAt: Number.NEGATIVE_INFINITY,
    activeSince: null,
    lastSeenAt: Date.now(),
    dispose: () => undefined,
  };

  const onData = (data: string) => {
    if (data.length < MIN_DATA_BYTES) return;
    const t = Date.now();
    // Suppress data that arrived within the echo window of an input we
    // sent — that's the terminal echoing the keystroke back, not the
    // agent doing work.
    if (t - state.lastInputAt < INPUT_ECHO_MS) return;
    // Open a new active streak when this is either the first ever data
    // or the previous streak had time to lapse into idle.
    if (
      state.activeSince == null ||
      state.lastDataAt == null ||
      t - state.lastDataAt > ACTIVITY_IDLE_MS
    ) {
      state.activeSince = t;
    }
    state.lastDataAt = t;
  };
  const onExit = () => {
    // Leave lastDataAt alone: it marks the time of the last actual
    // output, which is what drives "unseen output" flashing. Stamping
    // it to Date.now() here would hide the exit from that check.
    state.exited = true;
  };

  pty.onData(onData);
  pty.onExit(onExit);
  state.dispose = () => {
    pty.offData(onData);
    pty.offExit(onExit);
  };

  sessions.set(name, state);
}

export function detach(name: string): void {
  const state = sessions.get(name);
  if (!state) return;
  state.dispose();
  sessions.delete(name);
}

export function noteInput(name: string): void {
  const state = sessions.get(name);
  if (state) state.lastInputAt = Date.now();
}

/** Acknowledge that the user has seen everything the session has
 * produced up to now — clears any pending "needs attention" state. */
export function noteSeen(name: string): void {
  const state = sessions.get(name);
  if (state) state.lastSeenAt = Date.now();
}

export interface ActivitySnapshot {
  /** Agent is currently producing output. */
  active: boolean;
  /** Session ran for at least MIN_ACTIVE_MS, then went idle, and the
   * user hasn't looked at it since the most recent output. */
  flashing: boolean;
}

const QUIET: ActivitySnapshot = { active: false, flashing: false };

export function __resetForTests(): void {
  for (const state of sessions.values()) state.dispose();
  sessions.clear();
}

export function snapshot(name: string): ActivitySnapshot {
  const state = sessions.get(name);
  if (!state || state.lastDataAt == null) return QUIET;
  const t = Date.now();
  const active = !state.exited && t - state.lastDataAt < ACTIVITY_IDLE_MS;
  const streakMs =
    state.activeSince != null ? state.lastDataAt - state.activeSince : 0;
  const flashing =
    !active && streakMs >= MIN_ACTIVE_MS && state.lastDataAt > state.lastSeenAt;
  return active === false && flashing === false ? QUIET : { active, flashing };
}
