import {
  authError,
  countRequest,
  diffRequestCounters,
  formatRequestCounters,
  getRequestCounters,
  networkError,
  quotaExhausted,
  readJsonResponse,
  RequestCache,
  retryAfterMs,
  throttledError,
  ThrottleGate,
  type RequestCounters,
} from '@kirby/vcs-core';
import { log } from '@kirby/logger';
import { tracedFetch } from './client.js';
import { clearPrDetails } from './pr-details.js';

/**
 * Every request to Azure DevOps goes through here, and nothing else in
 * this package calls `fetch` directly.
 *
 * That is the point: the three things that were missing — knowing what
 * an HTML answer means, not asking twice for something we already have,
 * and stopping when told to — are properties of the whole client, not
 * of individual call sites. Scattering them over a dozen `fetch`
 * invocations is how they were missing from most of them.
 */

export const PROVIDER_NAME = 'Azure DevOps';
export const PROVIDER_ID = 'azure-devops';

/**
 * How long each kind of answer stays usable.
 *
 * Set by how fast the underlying thing actually changes, not by how
 * often something asks for it. A build status moves in tens of
 * seconds; a repository's id does not move at all. The sidebar polls
 * its model every four seconds and the review workspace polls
 * alongside it, so without these every one of those ticks was a fan of
 * requests per pull request.
 */
export const TTL = {
  /** Statuses posted against a pull request. */
  statuses: 30_000,
  /** Pipeline runs. */
  builds: 30_000,
  /** Comment threads — shared by the sidebar's count and the viewer. */
  threads: 15_000,
  /** Completed pull requests, for the merged-branch sweep. */
  mergedPrs: 60_000,
  /** Pull request description. */
  description: 5 * 60_000,
  /** Who we are, which teams we are in, and the repository's id. */
  identity: 30 * 60_000,
} as const;

const cache = new RequestCache({ providerId: PROVIDER_ID });
const gate = new ThrottleGate();

/**
 * Markers of the sign-in page Azure serves in place of data when the
 * personal access token is expired, revoked, or scoped too narrowly.
 *
 * It arrives as `203 Non-Authoritative Information` with an HTML body —
 * a status the fetch API considers a success — which is why parsing it
 * as JSON produced a complaint about a `<` rather than anything about
 * credentials.
 */
const SIGN_IN_MARKERS = [
  'sign in to your account',
  'azure devops services | sign in',
  'login.microsoftonline.com',
  '/_signin',
  'signinredirect',
];

export function looksLikeAdoSignIn(body: string): boolean {
  const head = body.slice(0, 4096).toLowerCase();
  return SIGN_IN_MARKERS.some((marker) => head.includes(marker));
}

function isHtml(res: Response): boolean {
  const contentType = res.headers.get('content-type') ?? '';
  return contentType.toLowerCase().includes('html');
}

/**
 * Issue one request, honouring the gate and updating it from the
 * response headers. Never parses anything.
 *
 * A refusal does not sleep and retry here. Kirby is a polling client:
 * the retry is the next poll, which the gate holds off until the wait
 * has elapsed. Sleeping inside the call instead would keep a sync
 * cycle — and, in the TUI, the pass that draws the sidebar — parked on
 * a timer for as long as Azure felt like naming.
 */
async function send(
  context: string,
  url: string,
  init?: RequestInit & { bodyForLog?: unknown }
): Promise<Response> {
  const paused = gate.pausedForMs();
  if (paused > 0) {
    countRequest(PROVIDER_ID, 'throttled');
    throw throttledError(PROVIDER_NAME, paused);
  }

  countRequest(PROVIDER_ID, 'network');
  let res: Response;
  try {
    res = await tracedFetch(context, url, init);
  } catch (cause) {
    throw networkError(PROVIDER_NAME, { cause });
  }

  if (res.status === 429 || res.status === 503) {
    const wait = gate.noteThrottled(retryAfterMs(res.headers));
    throw throttledError(PROVIDER_NAME, wait, { status: res.status });
  }

  gate.noteSuccess();
  if (quotaExhausted(res.headers)) {
    // Azure warns before it refuses. Standing down now costs one poll
    // interval; ignoring it costs the backoff on the refusal that
    // follows.
    const wait = gate.noteQuotaExhausted(retryAfterMs(res.headers));
    log('warn', 'ado.throttle', `quota spent — pausing for ${wait}ms`);
  }
  return res;
}

/** Read a response as JSON, classifying anything that is not. */
async function toJson<T>(res: Response, what?: string): Promise<T> {
  // Azure's sign-in bounce lands as a 2xx HTML page. Nothing this
  // client asks for is legitimately served that way, so an HTML body
  // under a 203 is a rejected credential and nothing else.
  if (res.status === 203 && isHtml(res)) {
    throw authError(PROVIDER_NAME, {
      status: 203,
      contentType: res.headers.get('content-type') ?? undefined,
    });
  }
  return readJsonResponse<T>(res, {
    providerName: PROVIDER_NAME,
    what,
    isSignInBody: looksLikeAdoSignIn,
  });
}

/** A GET whose result is worth remembering for `ttlMs`. */
export function adoGet<T>(
  context: string,
  key: string,
  ttlMs: number,
  url: string,
  headers: Record<string, string>,
  what?: string
): Promise<T> {
  return cache.get(key, ttlMs, async () =>
    toJson<T>(await send(context, url, { headers }), what)
  );
}

/**
 * A GET whose paging state matters as much as its body.
 *
 * Azure treats `$top` as a maximum, not a promise, and signals "there
 * is more" with an `x-ms-continuationtoken` header rather than by
 * filling the page. Inferring truncation from the row count therefore
 * reads a short-but-continued page as a complete one — so the token
 * comes back alongside the data, and is cached with it, since a cached
 * body's paging state is part of the answer.
 */
export function adoGetPage<T>(
  context: string,
  key: string,
  ttlMs: number,
  url: string,
  headers: Record<string, string>,
  what?: string
): Promise<{ data: T; continuation: string | null }> {
  return cache.get(key, ttlMs, async () => {
    const res = await send(context, url, { headers });
    const continuation = res.headers.get('x-ms-continuationtoken');
    return { data: await toJson<T>(res, what), continuation };
  });
}

/** A write. Never cached, never deduped — two identical replies are
 *  two replies, not one asked for twice. */
export async function adoSend<T>(
  context: string,
  url: string,
  init: RequestInit & { bodyForLog?: unknown }
): Promise<T> {
  return toJson<T>(await send(context, url, init));
}

/** Drop one cached entry by its exact key — used after a write, so the
 *  next read sees what was just changed. */
export function invalidateAdoKey(key: string): void {
  cache.delete(key);
}

/** Drop every cached entry whose key starts with `prefix`. Prefixes
 *  must end at a separator: `.../threads/1` is a prefix of
 *  `.../threads/10`, so an unterminated one invalidates ten times what
 *  it names. */
export function invalidateAdoCache(prefix: string): void {
  cache.invalidate(prefix);
}

/**
 * Forget everything cached about the provider.
 *
 * Called when the credentials or the project coordinates change: every
 * cached answer was fetched as somebody else, and a stale one would
 * make a corrected token look like it had not worked. Reopening the
 * gate is part of the same idea — a fresh credential deserves an
 * immediate attempt rather than the tail of the previous one's backoff.
 *
 * The per-pull-request memo goes with it. It is not held in this cache
 * — it outlives any single response by design — but it is just as much
 * an answer fetched as somebody else.
 */
export function resetAdoTransport(): void {
  cache.invalidate();
  gate.reset();
  clearPrDetails();
}

/** Test seam: the gate, so backoff behaviour can be driven directly. */
export function _adoThrottleGateForTests(): ThrottleGate {
  return gate;
}

/**
 * Wrap one logical operation and log what it cost in requests.
 *
 * `KIRBY_LOG` gates the output (the counters themselves are four
 * integers and always run), which makes "how many calls is one sync
 * cycle?" a question with an answer instead of an estimate.
 */
export async function counted<T>(
  label: string,
  run: () => Promise<T>
): Promise<T> {
  const before: RequestCounters = getRequestCounters(PROVIDER_ID);
  try {
    return await run();
  } finally {
    const delta = diffRequestCounters(before, getRequestCounters(PROVIDER_ID));
    log('debug', 'ado.requests', `${label}: ${formatRequestCounters(delta)}`);
  }
}
