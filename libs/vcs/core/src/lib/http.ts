import {
  authError,
  notFoundError,
  serverError,
  throttledError,
  unexpectedResponseError,
  VcsError,
} from './errors.js';
import { sanitizeBody } from './sanitize.js';

/**
 * Turning one HTTP response into either data or a {@link VcsError}.
 *
 * The rule this exists to enforce is that **nothing is parsed as JSON
 * until the response has been shown to be JSON**. A REST client that
 * calls `res.json()` unconditionally reports every interstitial the
 * internet can put in front of an API — a sign-in page, an SSO bounce,
 * a proxy's throttling notice — as a syntax error about a `<`.
 */

/** Statuses that mean "slow down" rather than "you got it wrong". */
const THROTTLE_STATUSES = new Set([429, 503]);

export interface JsonResponseOptions {
  /** Display name used in every message, e.g. `Azure DevOps`. */
  providerName: string;
  /** What was being fetched, for the not-found message. */
  what?: string;
  /**
   * Provider-specific sniff for "this HTML is a login page". Azure
   * answers an expired PAT with one under a 2xx status, so the body is
   * the only thing that distinguishes it from a broken gateway.
   */
  isSignInBody?: (body: string) => boolean;
  /** Fallback wait when a throttling response names no Retry-After. */
  defaultRetryAfterMs?: number;
}

const DEFAULT_RETRY_AFTER_MS = 30_000;

/**
 * How long the server asked us to wait, in ms, or null.
 *
 * `Retry-After` is either a delta in seconds or an HTTP date; Azure
 * sends the former on its own throttling responses and the latter
 * essentially never, but both are legal. `X-RateLimit-Reset` is a unix
 * timestamp in seconds and is what Azure sends when a quota — rather
 * than one request — is what ran out.
 */
/** A header's value, or null when it is absent or blank.
 *
 *  `headers.get` answers `''` for a header that is present with no
 *  value, and `Number('')` is `0` — so a gateway emitting a bare
 *  `X-RateLimit-Remaining:` would otherwise read as a spent quota and
 *  stand the whole client down. */
function headerValue(
  headers: Pick<Headers, 'get'>,
  name: string
): string | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

export function retryAfterMs(
  headers: Pick<Headers, 'get'>,
  now: number = Date.now()
): number | null {
  const raw = headerValue(headers, 'retry-after');
  if (raw) {
    const asSeconds = Number(raw);
    if (Number.isFinite(asSeconds)) return Math.max(0, asSeconds * 1000);
    const asDate = Date.parse(raw);
    if (!Number.isNaN(asDate)) return Math.max(0, asDate - now);
  }
  const resetRaw = headerValue(headers, 'x-ratelimit-reset');
  const reset = resetRaw === null ? NaN : Number(resetRaw);
  if (Number.isFinite(reset) && reset > 0) {
    return Math.max(0, reset * 1000 - now);
  }
  return null;
}

/**
 * Whether a *successful* response says the quota is spent. Azure sends
 * `X-RateLimit-Remaining: 0` before it starts refusing outright, which
 * is the last chance to back off without having already been refused.
 */
export function quotaExhausted(headers: Pick<Headers, 'get'>): boolean {
  const remaining = headerValue(headers, 'x-ratelimit-remaining');
  if (remaining === null) return false;
  const n = Number(remaining);
  return Number.isFinite(n) && n <= 0;
}

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const essence = contentType.split(';')[0]!.trim().toLowerCase();
  return essence.endsWith('/json') || essence.endsWith('+json');
}

/**
 * The API's own error text, if the body is JSON and carries one.
 *
 * This is the one place body-derived text reaches a user-facing
 * message, and it earns the exception: `TF401019: The Git repository
 * does not exist` names the mistake, where "returned an error (400)"
 * sends the reader to the network tab. It is also the one place that
 * has to be careful — the string lands in an Ink `<Text>` and in the
 * desktop status bar — so it is stripped of escape sequences and
 * capped. Nothing else about a body is ever quoted.
 */
function apiMessage(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      const message = (parsed as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) {
        return sanitizeBody(message.trim()).slice(0, 200);
      }
    }
  } catch {
    // Not JSON — the caller already has a better description.
  }
  return null;
}

/** The failure a status code alone determines, before the body matters. */
function errorFromStatus(
  res: Pick<Response, 'status' | 'headers'>,
  opts: JsonResponseOptions
): VcsError | null {
  const { providerName } = opts;
  const status = res.status;
  if (THROTTLE_STATUSES.has(status)) {
    const wait =
      retryAfterMs(res.headers) ??
      opts.defaultRetryAfterMs ??
      DEFAULT_RETRY_AFTER_MS;
    return throttledError(providerName, wait, { status });
  }
  if (status === 401 || status === 403)
    return authError(providerName, { status });
  if (status === 404) {
    return notFoundError(providerName, opts.what ?? 'that resource', {
      status,
    });
  }
  return null;
}

/**
 * A body that arrived where JSON was expected. HTML that asks the user
 * to sign in is a credential failure wearing a 200; anything else is
 * simply not an answer we can use.
 */
function errorFromNonJsonBody(
  res: Pick<Response, 'status' | 'headers'>,
  body: string,
  opts: JsonResponseOptions
): VcsError {
  const contentType = res.headers.get('content-type') ?? undefined;
  const details = { status: res.status, contentType };
  if (opts.isSignInBody?.(body)) return authError(opts.providerName, details);
  return unexpectedResponseError(opts.providerName, details);
}

/**
 * Read a response as JSON, or throw a classified {@link VcsError}.
 *
 * Ordering matters: status-only verdicts first (a 429's body is
 * irrelevant), then the content type, then the parse. A non-ok status
 * carrying real JSON keeps the API's own message, which is the
 * difference between "Azure DevOps returned an error (400)" and being
 * told the repository name is wrong.
 */
export async function readJsonResponse<T>(
  res: Response,
  opts: JsonResponseOptions
): Promise<T> {
  const fromStatus = errorFromStatus(res, opts);
  if (fromStatus) throw fromStatus;

  const body = await res.text();
  if (!isJsonContentType(res.headers.get('content-type'))) {
    throw errorFromNonJsonBody(res, body, opts);
  }

  if (!res.ok) {
    const detail = apiMessage(body);
    throw new VcsError(
      'server',
      detail
        ? `${opts.providerName}: ${detail}`
        : serverError(opts.providerName, { status: res.status }).message,
      { status: res.status }
    );
  }

  try {
    return JSON.parse(body) as T;
  } catch (cause) {
    // A JSON content type whose body is not JSON: truncated response,
    // or something in the middle rewriting bodies but not headers.
    throw unexpectedResponseError(opts.providerName, {
      status: res.status,
      contentType: res.headers.get('content-type') ?? undefined,
      cause,
    });
  }
}
