import { describe, expect, it, vi } from 'vitest';
import { RequestCache } from './request-cache.js';
import { getRequestCounters, resetRequestCounters } from './request-stats.js';

/**
 * The cache in front of a provider, driven directly.
 *
 * Every property here is one Kirby was relying on and did not have:
 * concurrent callers sharing a request, a repeat inside the TTL
 * costing nothing, and — the one that is easy to get backwards — a
 * failure never being kept.
 */

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** A loader that resolves when told, counting how often it was called. */
function deferred<T>() {
  const calls: { resolve: (v: T) => void; reject: (e: unknown) => void }[] = [];
  const load = () =>
    new Promise<T>((resolve, reject) => calls.push({ resolve, reject }));
  return { load, calls };
}

describe('RequestCache', () => {
  it('serves a repeat read from memory inside the TTL', async () => {
    const time = clock();
    const cache = new RequestCache({ now: time.now });
    const load = vi.fn().mockResolvedValue('v');

    expect(await cache.get('k', 1_000, load)).toBe('v');
    time.advance(999);
    expect(await cache.get('k', 1_000, load)).toBe('v');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('goes back out once the TTL has lapsed', async () => {
    const time = clock();
    const cache = new RequestCache({ now: time.now });
    const load = vi.fn().mockResolvedValue('v');

    await cache.get('k', 1_000, load);
    time.advance(1_001);
    await cache.get('k', 1_000, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('dates an entry from when it resolved, not when it was asked for', async () => {
    // A slow request is not stale the moment it lands. Stamping it with
    // its start time would expire a five-second response after five
    // fewer seconds than it was meant to live.
    const time = clock();
    const cache = new RequestCache({ now: time.now });
    const { load, calls } = deferred<string>();

    const first = cache.get('k', 1_000, load);
    time.advance(900);
    calls[0]!.resolve('v');
    await first;

    time.advance(500);
    await cache.get('k', 1_000, vi.fn());
    expect(calls).toHaveLength(1);
  });

  it('shares one request between callers that arrive together', async () => {
    const cache = new RequestCache();
    const { load, calls } = deferred<string>();

    const all = Promise.all([
      cache.get('k', 0, load),
      cache.get('k', 0, load),
      cache.get('k', 0, load),
    ]);
    expect(calls).toHaveLength(1);
    calls[0]!.resolve('v');
    expect(await all).toEqual(['v', 'v', 'v']);
  });

  it('dedupes without caching when the TTL is zero', async () => {
    const cache = new RequestCache();
    const load = vi.fn().mockResolvedValue('v');
    await cache.get('k', 0, load);
    await cache.get('k', 0, load);
    // Zero means "two callers at once share a request", not "remember
    // the answer forever" — the poll interval is the caller's to set.
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never keeps a failure', async () => {
    const cache = new RequestCache();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue('v');

    await expect(cache.get('k', 60_000, load)).rejects.toThrow('down');
    // Caching this would make one bad minute last a whole TTL.
    expect(await cache.get('k', 60_000, load)).toBe('v');
  });

  it('still shares a request that is going to fail', async () => {
    const cache = new RequestCache();
    const { load, calls } = deferred<string>();
    const a = cache.get('k', 0, load);
    const b = cache.get('k', 0, load);
    calls[0]!.reject(new Error('down'));
    await expect(a).rejects.toThrow('down');
    await expect(b).rejects.toThrow('down');
    // One dead credential produces one failure per poll, not N.
    expect(calls).toHaveLength(1);
  });

  it('honours the shortest TTL among callers sharing a request', async () => {
    // Two callers can join on one key with different TTLs, and only the
    // smallest is safe: a caller that asked for "dedupe only" must not
    // be handed a minute-old answer because somebody else was content
    // with one.
    const time = clock();
    const cache = new RequestCache({ now: time.now });
    const { load, calls } = deferred<string>();

    const both = Promise.all([
      cache.get('k', 60_000, load),
      cache.get('k', 0, load),
    ]);
    expect(calls).toHaveLength(1);
    calls[0]!.resolve('v');
    await both;

    const later = vi.fn().mockResolvedValue('w');
    expect(await cache.get('k', 60_000, later)).toBe('w');
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('keeps keys apart', async () => {
    const cache = new RequestCache();
    const load = vi
      .fn()
      .mockImplementation((): Promise<string> => Promise.resolve('v'));
    await Promise.all([
      cache.get('a', 1_000, load),
      cache.get('b', 1_000, load),
    ]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidates by prefix, leaving the rest alone', async () => {
    const cache = new RequestCache();
    const load = vi.fn().mockResolvedValue('v');
    await cache.get('pr/7/threads', 60_000, load);
    await cache.get('pr/8/threads', 60_000, load);
    expect(load).toHaveBeenCalledTimes(2);

    cache.invalidate('pr/7/');
    await cache.get('pr/7/threads', 60_000, load);
    await cache.get('pr/8/threads', 60_000, load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('counts what it saved', () => {
    resetRequestCounters('spec');
    const cache = new RequestCache({ providerId: 'spec' });
    const load = vi.fn().mockResolvedValue('v');
    return (async () => {
      await cache.get('k', 60_000, load);
      await cache.get('k', 60_000, load);
      await cache.get('k', 60_000, load);
      // The loader itself is what counts a network call, so only the
      // savings show up here — which is the number worth reporting.
      expect(getRequestCounters('spec').cached).toBe(2);
      resetRequestCounters('spec');
    })();
  });
});
