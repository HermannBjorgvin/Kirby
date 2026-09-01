import { describe, expect, it } from 'vitest';
import { ThrottleGate } from './throttle-gate.js';

/**
 * The backoff, driven on a clock we own.
 *
 * The behaviour that matters is not "waits after a 429" — it is that
 * the wait applies to the *whole* provider and that a second refusal
 * arriving from a request already in flight cannot shorten it.
 */

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function gate(over: { base?: number; max?: number } = {}) {
  const time = clock();
  return {
    time,
    g: new ThrottleGate({
      now: time.now,
      baseDelayMs: over.base ?? 1_000,
      maxDelayMs: over.max ?? 60_000,
    }),
  };
}

describe('ThrottleGate', () => {
  it('starts open', () => {
    expect(gate().g.isPaused()).toBe(false);
  });

  it('doubles the wait over consecutive refusals', () => {
    const { g, time } = gate();
    expect(g.noteThrottled(null)).toBe(1_000);
    time.advance(1_000);
    expect(g.noteThrottled(null)).toBe(2_000);
    time.advance(2_000);
    expect(g.noteThrottled(null)).toBe(4_000);
  });

  it('caps the wait', () => {
    const { g, time } = gate({ base: 1_000, max: 3_000 });
    for (let i = 0; i < 6; i++) {
      g.noteThrottled(null);
      time.advance(10_000);
    }
    expect(g.noteThrottled(null)).toBe(3_000);
  });

  it("takes the server's wait when it is longer than the backoff", () => {
    const { g } = gate();
    expect(g.noteThrottled(30_000)).toBe(30_000);
  });

  it('keeps its own backoff when the server asks for less', () => {
    // A `Retry-After: 1` on the fifth consecutive refusal is not an
    // invitation to go straight back.
    const { g, time } = gate();
    g.noteThrottled(null);
    time.advance(1_000);
    g.noteThrottled(null);
    time.advance(2_000);
    expect(g.noteThrottled(1_000)).toBe(4_000);
  });

  it('opens again once the wait has elapsed', () => {
    const { g, time } = gate();
    g.noteThrottled(5_000);
    time.advance(4_999);
    expect(g.isPaused()).toBe(true);
    time.advance(2);
    expect(g.isPaused()).toBe(false);
  });

  it('never shortens a pause already in effect', () => {
    // The burst that got refused is still in flight; its later
    // refusals must not reopen the gate ahead of the first one.
    const { g, time } = gate();
    g.noteThrottled(60_000);
    time.advance(1_000);
    g.noteThrottled(1);
    expect(g.pausedForMs()).toBe(59_000);
  });

  it('reopens and forgets the escalation on success', () => {
    const { g, time } = gate();
    g.noteThrottled(null);
    time.advance(1_000);
    g.noteThrottled(null);
    g.noteSuccess();

    expect(g.isPaused()).toBe(false);
    expect(g.strikes).toBe(0);
    expect(g.noteThrottled(null)).toBe(1_000);
  });

  it('pauses on a spent quota without counting it as a refusal', () => {
    // Nothing failed: a successful response said the budget is gone.
    // Starting the escalation on it would punish the polite path.
    const { g } = gate();
    expect(g.noteQuotaExhausted(10_000)).toBe(10_000);
    expect(g.strikes).toBe(0);
  });

  it('falls back to the base delay when a spent quota names no reset', () => {
    const { g } = gate();
    expect(g.noteQuotaExhausted(null)).toBe(1_000);
  });
});
