import {
  throttledError,
  unavailableError,
  VcsError,
  type VcsErrorKind,
} from '@kirby/vcs-core';

/**
 * What went wrong when `gh` did.
 *
 * The GitHub provider's transport is a subprocess, so its failures
 * arrive as an exit code plus whatever the CLI printed — and the CLI
 * prints the same shape of text whether the token expired, the
 * repository moved, or the binary is not installed at all. Everything
 * reached the user as `gh graphql error: <the whole of stderr>`, which
 * is a log line rather than something to act on.
 *
 * The classification is by substring because that is the interface
 * `gh` offers; each pattern below is a message `gh` emits verbatim.
 */

export const PROVIDER_NAME = 'GitHub';

/** GitHub's own default before a rate limit resets, when it names none. */
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

/** stdout/stderr/message of whatever `execFile` rejected with. */
export function ghOutput(err: unknown): string {
  if (err == null || typeof err !== 'object') return String(err);
  const e = err as Record<string, unknown>;
  const parts = [e.stderr, e.stdout, e.message]
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .map((p) => p.trim());
  return parts.length > 0 ? parts.join('\n') : String(err);
}

function code(err: unknown): string {
  if (err == null || typeof err !== 'object') return '';
  const value = (err as { code?: unknown }).code;
  return typeof value === 'string' ? value : '';
}

/**
 * Patterns in the order they must be tested.
 *
 * Throttling before auth is not a stylistic choice: GitHub reports a
 * spent rate limit as `HTTP 403`, so an auth check that ran first
 * would tell the user to re-authenticate a token that is working
 * perfectly well and simply has nothing left this hour.
 */
const PATTERNS: { kind: VcsErrorKind; match: RegExp }[] = [
  {
    kind: 'throttled',
    match:
      /api rate limit exceeded|secondary rate limit|you have exceeded a rate limit|http 429/i,
  },
  {
    kind: 'auth',
    match:
      /gh auth login|bad credentials|http 401|authentication token|requires authentication|not accessible by (personal access token|integration)|saml enforcement/i,
  },
  { kind: 'not-found', match: /http 404|could not resolve to a/i },
  { kind: 'server', match: /http 5\d\d|internal server error/i },
];

const MESSAGES: Partial<Record<VcsErrorKind, string>> = {
  auth: 'GitHub rejected the request — run `gh auth login` to re-authenticate',
  'not-found': 'GitHub could not find that repository or pull request',
  server: 'GitHub returned an error',
};

/**
 * Turn a rejected `gh` invocation into a {@link VcsError}.
 *
 * A missing binary is called out separately because it is the one
 * failure here that is neither the user's credentials nor GitHub's
 * fault, and the fix is completely different.
 */
export function classifyGhError(err: unknown): VcsError {
  if (code(err) === 'ENOENT') {
    return unavailableError(
      'The GitHub CLI (gh) is not installed — Kirby reaches GitHub through it',
      { cause: err }
    );
  }

  const output = ghOutput(err);
  for (const { kind, match } of PATTERNS) {
    if (!match.test(output)) continue;
    if (kind === 'throttled') {
      return throttledError(PROVIDER_NAME, DEFAULT_RATE_LIMIT_WAIT_MS, {
        cause: err,
      });
    }
    return new VcsError(kind, MESSAGES[kind] ?? output, { cause: err });
  }
  // Nothing recognised: the CLI's own words are still the best
  // description available, and hiding them would lose the only clue.
  return new VcsError('unknown', `gh: ${output}`, { cause: err });
}

/**
 * Parse `gh`'s stdout, or say that it was not JSON.
 *
 * `gh` writes diagnostics to stderr and data to stdout, but a broken
 * install, a shell wrapper, or an update notice can put text on stdout
 * ahead of the payload. Parsing it blind produced a `SyntaxError` that
 * named a character position in output the user never sees.
 */
export function parseGhJson<T>(stdout: string, what: string): T {
  try {
    return JSON.parse(stdout) as T;
  } catch (cause) {
    throw new VcsError(
      'unexpected-response',
      `Unexpected output from the GitHub CLI while reading ${what}`,
      { cause }
    );
  }
}

/**
 * A GraphQL response that carries errors and no data.
 *
 * Partial failures — one field resolving to null with an error beside
 * it — are left alone: GitHub returns those routinely and the callers
 * handle a missing field. It is the total failure that used to surface
 * as a `TypeError` several frames away from the cause.
 */
export function assertGraphQlData(payload: unknown, what: string): void {
  if (payload == null || typeof payload !== 'object') return;
  const { data, errors } = payload as { data?: unknown; errors?: unknown[] };
  if (data != null || !Array.isArray(errors) || errors.length === 0) return;
  const first = errors[0];
  const detail =
    first &&
    typeof first === 'object' &&
    typeof (first as { message?: unknown }).message === 'string'
      ? (first as { message: string }).message
      : 'no data returned';
  throw new VcsError('server', `GitHub could not answer ${what}: ${detail}`);
}
