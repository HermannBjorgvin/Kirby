/**
 * The valve in front of a provider that has asked us to stop.
 *
 * Backing off one request is not enough. Kirby issues a burst per sync
 * cycle — a list, then per-pull-request reads — so a 429 on the first
 * of them is a prediction about the rest, and retrying each of those
 * individually is how a throttled client becomes a blocked one. The
 * gate therefore closes for *every* call to that provider until the
 * wait the server named has elapsed.
 *
 * Wait length is the larger of what the server asked for and an
 * exponential backoff over consecutive refusals, capped. A single 429
 * that names no `Retry-After` pauses briefly; a provider refusing
 * everything escalates towards the cap instead of hammering it every
 * poll. One success reopens the gate and resets the escalation.
 */

export interface ThrottleGateOptions {
  now?: () => number;
  /** Wait after the first refusal, doubling from there. */
  baseDelayMs?: number;
  /** Ceiling for the computed backoff. */
  maxDelayMs?: number;
}

const DEFAULT_BASE_MS = 2_000;
const DEFAULT_MAX_MS = 5 * 60_000;

export class ThrottleGate {
  private readonly now: () => number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private openAt = 0;
  private consecutive = 0;

  constructor(options: ThrottleGateOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_MS;
  }

  /** ms until the gate opens; 0 when it is open now. */
  pausedForMs(): number {
    return Math.max(0, this.openAt - this.now());
  }

  isPaused(): boolean {
    return this.pausedForMs() > 0;
  }

  /**
   * Record a refusal and close the gate. Returns how long it is closed
   * for, so the caller can put the number in the error it throws.
   */
  noteThrottled(retryAfterMs?: number | null): number {
    this.consecutive += 1;
    const backoff = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * 2 ** (this.consecutive - 1)
    );
    const wait = Math.min(
      this.maxDelayMs,
      Math.max(backoff, retryAfterMs ?? 0)
    );
    // Never shorten an existing pause: a second refusal arriving from a
    // request that was already in flight must not reopen the gate early.
    this.openAt = Math.max(this.openAt, this.now() + wait);
    return this.pausedForMs();
  }

  /**
   * Close the gate for exactly as long as the server said, without
   * counting it as a refusal. Used for a *successful* response whose
   * headers say the quota is spent — nothing went wrong yet, and the
   * escalation should not start on the strength of it.
   */
  noteQuotaExhausted(retryAfterMs: number | null): number {
    const wait = Math.min(
      this.maxDelayMs,
      Math.max(0, retryAfterMs ?? this.baseDelayMs)
    );
    this.openAt = Math.max(this.openAt, this.now() + wait);
    return this.pausedForMs();
  }

  /**
   * A request got through.
   *
   * This only reopens a gate that is already open — which sounds like
   * a contradiction and is the whole point. A sync cycle fans its
   * requests out at once, so a refusal and a pile of successes are the
   * normal result of one burst, and the successes arrive *after* the
   * refusal has closed the gate. Letting them clear it would cancel
   * every pause the moment it was set, fan the same burst out again on
   * the next tick, and hold the escalation at zero forever.
   *
   * Once the wait has elapsed the gate is open again on its own, and
   * the first request through it resets the escalation here.
   */
  noteSuccess(): void {
    if (this.isPaused()) return;
    this.consecutive = 0;
    this.openAt = 0;
  }

  /** Consecutive refusals since the last success. Diagnostics only. */
  get strikes(): number {
    return this.consecutive;
  }

  reset(): void {
    this.consecutive = 0;
    this.openAt = 0;
  }
}
