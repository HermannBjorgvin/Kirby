import { countRequest } from './request-stats.js';

/**
 * One cache in front of a provider's reads, doing two jobs that are
 * easy to confuse and both necessary:
 *
 *   • **dedupe** — two callers asking for the same thing at the same
 *     moment share one request. The sidebar refresh, the review
 *     workspace and the merged-branch sweep all want a pull request's
 *     threads, and they do not coordinate.
 *   • **cache** — the same thing asked for again shortly afterwards is
 *     answered from memory. Build statuses change on the order of
 *     tens of seconds; a comment count does not change at all between
 *     two polls a second apart.
 *
 * Failures are never cached. A rejected entry is dropped as soon as it
 * settles, so a transient error does not become the answer for the
 * rest of its TTL — but it is still deduped while in flight, which is
 * what stops one dead credential producing N identical failures per
 * poll.
 */

interface Entry<T> {
  /** Present while the request is in flight. */
  promise: Promise<T> | null;
  /** Present once it has resolved. */
  value: T | null;
  hasValue: boolean;
  storedAt: number;
  /**
   * The shortest TTL any caller sharing this request asked for.
   *
   * Callers join by key, and nothing stops two of them naming
   * different TTLs. Keeping the smallest is the only choice that can
   * never hand someone data staler than they asked for: a caller that
   * said "dedupe only" is not served a minute-old answer because
   * somebody else was happy with one.
   */
  ttlMs: number;
}

export interface RequestCacheOptions {
  /** Injectable clock — the tests drive this with fake timers. */
  now?: () => number;
  /** Counted under this id in the request statistics. */
  providerId?: string;
}

export class RequestCache {
  private readonly entries = new Map<string, Entry<unknown>>();
  private readonly now: () => number;
  private readonly providerId: string;

  constructor(options: RequestCacheOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.providerId = options.providerId ?? 'vcs';
  }

  /**
   * The cached value for `key` if it is younger than `ttlMs`, the
   * in-flight request for it if one exists, or a new one from `load`.
   *
   * `ttlMs` of 0 means "dedupe only": concurrent callers still share a
   * request, but nothing is served from memory afterwards.
   */
  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key) as Entry<T> | undefined;
    if (entry) {
      if (entry.promise) {
        entry.ttlMs = Math.min(entry.ttlMs, ttlMs);
        countRequest(this.providerId, 'deduped');
        return entry.promise;
      }
      if (entry.hasValue && this.now() - entry.storedAt < ttlMs) {
        countRequest(this.providerId, 'cached');
        return Promise.resolve(entry.value as T);
      }
    }
    return this.start(key, ttlMs, load);
  }

  private start<T>(
    key: string,
    ttlMs: number,
    load: () => Promise<T>
  ): Promise<T> {
    const fresh: Entry<T> = {
      promise: null,
      value: null,
      hasValue: false,
      storedAt: this.now(),
      ttlMs,
    };
    const promise = load().then(
      (value) => {
        // Only keep what someone can still use: a zero TTL entry has
        // served its purpose the moment its callers have their answer.
        // `fresh.ttlMs`, not the argument — a joiner may have asked for
        // less than the caller that started this.
        if (this.entries.get(key) === (fresh as Entry<unknown>)) {
          if (fresh.ttlMs > 0) {
            fresh.value = value;
            fresh.hasValue = true;
            fresh.storedAt = this.now();
            fresh.promise = null;
          } else {
            this.entries.delete(key);
          }
        }
        return value;
      },
      (err: unknown) => {
        // Never cache a failure — the next caller should try again.
        if (this.entries.get(key) === (fresh as Entry<unknown>)) {
          this.entries.delete(key);
        }
        throw err;
      }
    );
    fresh.promise = promise;
    this.entries.set(key, fresh as Entry<unknown>);
    return promise;
  }

  /** Forget one entry by its exact key. */
  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Forget everything, or everything whose key starts with `prefix`. */
  invalidate(prefix?: string): void {
    if (prefix === undefined) {
      this.entries.clear();
      return;
    }
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  /** Entries currently held, cached or in flight. Diagnostics only. */
  get size(): number {
    return this.entries.size;
  }
}
