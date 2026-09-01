/**
 * The failures a provider can hand back, named.
 *
 * Every provider used to throw bare `Error`s carrying whatever the
 * transport happened to say, and the transport's own idea of a failure
 * is frequently not one: Azure answers an expired token with a
 * *successful* HTTP status and an HTML sign-in page, which reached the
 * user as `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not
 * valid JSON` in the status bar. A shell cannot act on that, and
 * neither can the person reading it.
 *
 * So the classification happens once, next to the response, and the
 * shells render `message` verbatim. `kind` is what they branch on when
 * they want to do more than show text — offer the Settings page for an
 * `auth` failure, keep the last good sidebar for a `throttled` one.
 */
export type VcsErrorKind =
  /** Credentials rejected, expired, or never accepted. */
  | 'auth'
  /** The server asked us to slow down (429/503, or a spent quota). */
  | 'throttled'
  /** A 2xx/3xx body that is not the JSON the API documents — almost
   *  always an HTML interstitial (sign-in, SSO, a CDN error page). */
  | 'unexpected-response'
  /** The org, project, repository or pull request does not exist. */
  | 'not-found'
  /** The route to the provider is missing — a CLI that is not
   *  installed, a transport that cannot run here. Not retryable, and
   *  not the user's credentials. */
  | 'unavailable'
  /** The request never reached the server. */
  | 'network'
  /** The server answered, and the answer was its own failure. */
  | 'server'
  | 'unknown';

export interface VcsErrorDetails {
  /** HTTP status, when the failure came from a response. */
  status?: number;
  /** How long the server asked us to wait, in ms. */
  retryAfterMs?: number;
  /** Response `Content-Type`, kept for diagnostics. */
  contentType?: string;
  /** The underlying failure, when this wraps one. */
  cause?: unknown;
}

/**
 * A provider failure whose `message` is already fit to show a user.
 *
 * Response bodies stay out of the message, with one deliberate
 * exception: the API's own `message` field on a JSON error, which is
 * stripped of escape sequences and capped before it is quoted (see
 * `apiMessage` in http.ts). Everything else — an HTML error page is
 * attacker-influenced content in the general case, and a sign-in page
 * is several kilobytes besides — is described, never repeated.
 */
export class VcsError extends Error {
  readonly kind: VcsErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly contentType?: string;

  constructor(
    kind: VcsErrorKind,
    message: string,
    details: VcsErrorDetails = {}
  ) {
    super(
      message,
      details.cause !== undefined ? { cause: details.cause } : undefined
    );
    this.name = 'VcsError';
    this.kind = kind;
    this.status = details.status;
    this.retryAfterMs = details.retryAfterMs;
    this.contentType = details.contentType;
  }
}

export function isVcsError(err: unknown): err is VcsError {
  return err instanceof VcsError;
}

/** True when re-running the same request later might succeed. */
export function isRetryableVcsError(err: unknown): boolean {
  if (!isVcsError(err)) return true;
  return (
    err.kind === 'throttled' || err.kind === 'network' || err.kind === 'server'
  );
}

/** Whole seconds, rounded up, floored at 1 — "retrying in 0s" reads as broken. */
function seconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

export function authError(
  providerName: string,
  details: VcsErrorDetails = {}
): VcsError {
  return new VcsError(
    'auth',
    `${providerName} rejected the access token — update it in Settings`,
    details
  );
}

export function throttledError(
  providerName: string,
  retryAfterMs: number,
  details: VcsErrorDetails = {}
): VcsError {
  return new VcsError(
    'throttled',
    `${providerName} is throttling requests; retrying in ${seconds(
      retryAfterMs
    )}s`,
    { ...details, retryAfterMs }
  );
}

/**
 * A body that is not what the API promised. The shape is named in the
 * message because "HTML" is the difference between "the service is
 * broken" and "something in front of the service wants you to sign in".
 */
export function unexpectedResponseError(
  providerName: string,
  details: VcsErrorDetails = {}
): VcsError {
  const shape = describeShape(details.contentType);
  const status = details.status != null ? `, ${details.status}` : '';
  return new VcsError(
    'unexpected-response',
    `Unexpected response from ${providerName} (${shape}${status})`,
    details
  );
}

function describeShape(contentType: string | undefined): string {
  if (!contentType) return 'no content type';
  const essence = contentType.split(';')[0]!.trim().toLowerCase();
  if (essence === 'text/html' || essence === 'application/xhtml+xml')
    return 'HTML';
  if (essence === '') return 'no content type';
  return essence;
}

export function notFoundError(
  providerName: string,
  what: string,
  details: VcsErrorDetails = {}
): VcsError {
  return new VcsError(
    'not-found',
    `${providerName} could not find ${what}`,
    details
  );
}

export function unavailableError(
  message: string,
  details: VcsErrorDetails = {}
): VcsError {
  return new VcsError('unavailable', message, details);
}

export function serverError(
  providerName: string,
  details: VcsErrorDetails = {}
): VcsError {
  const status = details.status != null ? ` (${details.status})` : '';
  return new VcsError(
    'server',
    `${providerName} returned an error${status}`,
    details
  );
}

export function networkError(
  providerName: string,
  details: VcsErrorDetails = {}
): VcsError {
  const cause = details.cause;
  const detail =
    cause instanceof Error && cause.message ? `: ${cause.message}` : '';
  return new VcsError(
    'network',
    `Could not reach ${providerName}${detail}`,
    details
  );
}

/**
 * The string a shell should show for any thrown value. A `VcsError`
 * already carries one; everything else falls back to its message, and
 * a non-Error to its stringification.
 */
export function vcsErrorMessage(err: unknown): string {
  if (isVcsError(err)) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
