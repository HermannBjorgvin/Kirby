/**
 * How many times Kirby actually went to a provider, and how many times
 * it did not have to.
 *
 * The counters are always kept — they are four integers per provider —
 * but they are only ever *reported* when `KIRBY_LOG` is set, which is
 * also what enables the network trace they pair with. Their purpose is
 * answering "did that change reduce the request count?" with a number
 * rather than an impression, which is the only way to tell caching
 * from the appearance of caching.
 */

export type RequestOutcome =
  /** A request that went out on the wire. */
  | 'network'
  /** Answered from a cached value. */
  | 'cached'
  /** Joined a request already in flight. */
  | 'deduped'
  /** Not sent at all: the provider had asked us to back off. */
  | 'throttled';

export interface RequestCounters {
  network: number;
  cached: number;
  deduped: number;
  throttled: number;
}

const OUTCOMES: RequestOutcome[] = [
  'network',
  'cached',
  'deduped',
  'throttled',
];

const counters = new Map<string, RequestCounters>();

function bucket(providerId: string): RequestCounters {
  let found = counters.get(providerId);
  if (!found) {
    found = { network: 0, cached: 0, deduped: 0, throttled: 0 };
    counters.set(providerId, found);
  }
  return found;
}

export function countRequest(
  providerId: string,
  outcome: RequestOutcome
): void {
  bucket(providerId)[outcome] += 1;
}

/** A copy of one provider's counters. */
export function getRequestCounters(providerId: string): RequestCounters {
  return { ...bucket(providerId) };
}

export function resetRequestCounters(providerId?: string): void {
  if (providerId === undefined) counters.clear();
  else counters.delete(providerId);
}

/** `network=12 cached=30 deduped=4 throttled=0` — for a log line. */
export function formatRequestCounters(counts: RequestCounters): string {
  return OUTCOMES.map((o) => `${o}=${counts[o]}`).join(' ');
}

/** The difference between two snapshots, for per-cycle reporting. */
export function diffRequestCounters(
  before: RequestCounters,
  after: RequestCounters
): RequestCounters {
  return {
    network: after.network - before.network,
    cached: after.cached - before.cached,
    deduped: after.deduped - before.deduped,
    throttled: after.throttled - before.throttled,
  };
}
