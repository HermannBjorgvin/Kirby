import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isVcsError, type VcsError } from '@kirby/vcs-core';
import {
  _adoThrottleGateForTests,
  adoGet,
  looksLikeAdoSignIn,
  resetAdoTransport,
  TTL,
} from './request.js';

/**
 * What the client does with an answer that is not the answer.
 *
 * Azure DevOps has three ways of saying no that a JSON parser cannot
 * tell apart from a bug: an HTML sign-in page under a success status,
 * a throttling refusal, and an ordinary error carrying its own
 * message. All three used to arrive at the user as some form of
 * `SyntaxError`, which named neither the cause nor anything they could
 * do about it.
 *
 * The sign-in page is a recorded one — scrubbed, but the markup and
 * the markers matched against are Azure's.
 */

const SIGN_IN_HTML = readFileSync(
  join(__dirname, '__fixtures__', 'signin-page.html'),
  'utf8'
);

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const headers = { Authorization: 'Basic x' };

function response(
  body: string,
  init: {
    status?: number;
    contentType?: string;
    extraHeaders?: Record<string, string>;
  } = {}
): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    headers: new Headers({
      'content-type': init.contentType ?? 'application/json',
      ...init.extraHeaders,
    }),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/** One uncached read, so each test starts from the network. */
let counter = 0;
function get<T>(url = 'https://dev.azure.com/o/p/_apis/thing'): Promise<T> {
  return adoGet<T>('spec', `key-${++counter}`, 0, url, headers);
}

async function failure(promise: Promise<unknown>): Promise<VcsError> {
  try {
    await promise;
  } catch (err) {
    if (isVcsError(err)) return err;
    throw err;
  }
  throw new Error('expected the request to fail');
}

beforeEach(() => {
  mockFetch.mockReset();
  resetAdoTransport();
});

describe('the sign-in page', () => {
  it('matches the recorded page', () => {
    expect(looksLikeAdoSignIn(SIGN_IN_HTML)).toBe(true);
  });

  it('does not match an ordinary HTML error page', () => {
    // A 502 from something in front of Azure is not a credential
    // problem, and telling the user to update their token would send
    // them to change a token that works.
    expect(
      looksLikeAdoSignIn('<html><body><h1>502 Bad Gateway</h1></body></html>')
    ).toBe(false);
  });

  it('reads a 203 HTML body as a rejected token', async () => {
    mockFetch.mockResolvedValue(
      response(SIGN_IN_HTML, {
        status: 203,
        contentType: 'text/html; charset=utf-8',
      })
    );
    const err = await failure(get());
    expect(err.kind).toBe('auth');
    expect(err.message).toBe(
      'Azure DevOps rejected the access token — update it in Settings'
    );
  });

  it('reads a 200 sign-in page as a rejected token too', async () => {
    // The status Azure uses for the bounce is not something to rely
    // on; the page is.
    mockFetch.mockResolvedValue(
      response(SIGN_IN_HTML, { status: 200, contentType: 'text/html' })
    );
    expect((await failure(get())).kind).toBe('auth');
  });

  it('names the shape and the status for HTML it cannot explain', async () => {
    mockFetch.mockResolvedValue(
      response('<html><body>Service Unavailable</body></html>', {
        status: 203,
        contentType: 'text/html',
      })
    );
    // 203 alone is enough for Azure — the status is only used that way
    // for the sign-in bounce.
    expect((await failure(get())).kind).toBe('auth');

    mockFetch.mockResolvedValue(
      response('<html><body>nope</body></html>', {
        status: 200,
        contentType: 'text/html',
      })
    );
    const err = await failure(get());
    expect(err.kind).toBe('unexpected-response');
    expect(err.message).toBe(
      'Unexpected response from Azure DevOps (HTML, 200)'
    );
  });

  it('reports a truncated JSON body rather than the parser error', async () => {
    mockFetch.mockResolvedValue(response('{"value": [', { status: 200 }));
    const err = await failure(get());
    expect(err.kind).toBe('unexpected-response');
    expect(err.message).toContain('application/json');
  });
});

describe('status mapping', () => {
  it.each([401, 403])('maps %i to a rejected token', async (status) => {
    mockFetch.mockResolvedValue(response('{}', { status }));
    expect((await failure(get())).kind).toBe('auth');
  });

  it('maps 404 to not-found, naming what was missing', async () => {
    mockFetch.mockResolvedValue(response('{}', { status: 404 }));
    const err = await failure(
      adoGet('spec', 'nf', 0, 'https://x', headers, 'pull request 7')
    );
    expect(err.kind).toBe('not-found');
    expect(err.message).toBe('Azure DevOps could not find pull request 7');
  });

  it("keeps Azure's own message on a 400", async () => {
    // "TF401019: the repository does not exist" is worth far more than
    // "Azure DevOps returned an error (400)".
    mockFetch.mockResolvedValue(
      response(
        JSON.stringify({
          message: 'TF401019: The Git repository does not exist',
        }),
        { status: 400 }
      )
    );
    const err = await failure(get());
    expect(err.kind).toBe('server');
    expect(err.message).toContain('TF401019');
  });

  it('reports an unreachable server as a network failure', async () => {
    mockFetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const err = await failure(get());
    expect(err.kind).toBe('network');
    expect(err.message).toContain('Could not reach Azure DevOps');
  });
});

describe('throttling', () => {
  it('reports a 429 with the wait the server asked for', async () => {
    mockFetch.mockResolvedValue(
      response('', { status: 429, extraHeaders: { 'retry-after': '20' } })
    );
    const err = await failure(get());
    expect(err.kind).toBe('throttled');
    expect(err.message).toBe(
      'Azure DevOps is throttling requests; retrying in 20s'
    );
  });

  it('stops sending anything at all while the gate is closed', async () => {
    mockFetch.mockResolvedValue(
      response('', { status: 429, extraHeaders: { 'retry-after': '20' } })
    );
    await failure(get());
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // The rest of the sync cycle is not a fresh chance — it is the same
    // burst that just got refused. Sending it is what turns a throttled
    // client into a blocked one.
    for (let i = 0; i < 5; i++) await failure(get());
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('reopens once the wait has elapsed', async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockResolvedValue(
        response('', { status: 503, extraHeaders: { 'retry-after': '5' } })
      );
      await failure(get());

      vi.advanceTimersByTime(4_000);
      expect((await failure(get())).kind).toBe('throttled');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1_500);
      mockFetch.mockResolvedValue(response('{"ok":true}'));
      await get();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('escalates the wait over consecutive refusals, and forgets it on success', () => {
    vi.useFakeTimers();
    try {
      const gate = _adoThrottleGateForTests();
      // No Retry-After: the client picks the wait, doubling each time.
      expect(gate.noteThrottled(null)).toBe(2_000);
      vi.advanceTimersByTime(2_000);
      expect(gate.noteThrottled(null)).toBe(4_000);
      vi.advanceTimersByTime(4_000);
      expect(gate.noteThrottled(null)).toBe(8_000);

      gate.noteSuccess();
      expect(gate.isPaused()).toBe(false);
      expect(gate.noteThrottled(null)).toBe(2_000);
    } finally {
      _adoThrottleGateForTests().reset();
      vi.useRealTimers();
    }
  });

  it('stands down when a successful response says the quota is spent', async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockResolvedValue(
        response('{"value":[]}', {
          extraHeaders: { 'x-ratelimit-remaining': '0', 'retry-after': '10' },
        })
      );
      await get();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Azure warns before it refuses. Spending the warning is free;
      // ignoring it costs the backoff on the refusal that follows.
      expect((await failure(get())).kind).toBe('throttled');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(11_000);
      await get();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('caching and dedupe', () => {
  it('answers a repeat read from memory inside the TTL', async () => {
    mockFetch.mockResolvedValue(response('{"n":1}'));
    const url = 'https://dev.azure.com/o/p/_apis/thing';
    await adoGet('spec', 'shared', TTL.statuses, url, headers);
    await adoGet('spec', 'shared', TTL.statuses, url, headers);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('shares one request between callers that arrive together', async () => {
    mockFetch.mockResolvedValue(response('{"n":1}'));
    const url = 'https://dev.azure.com/o/p/_apis/thing';
    await Promise.all([
      adoGet('spec', 'together', 0, url, headers),
      adoGet('spec', 'together', 0, url, headers),
      adoGet('spec', 'together', 0, url, headers),
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('never caches a failure', async () => {
    mockFetch.mockResolvedValueOnce(response('{}', { status: 500 }));
    mockFetch.mockResolvedValue(response('{"n":1}'));
    const url = 'https://dev.azure.com/o/p/_apis/thing';
    await failure(adoGet('spec', 'retry', TTL.statuses, url, headers));
    // A transient error must not become the answer for the rest of the
    // TTL — the next caller gets a real attempt.
    await adoGet('spec', 'retry', TTL.statuses, url, headers);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('forgets everything when the credentials change', async () => {
    mockFetch.mockResolvedValue(response('{"n":1}'));
    const url = 'https://dev.azure.com/o/p/_apis/thing';
    await adoGet('spec', 'rotated', TTL.identity, url, headers);
    resetAdoTransport();
    await adoGet('spec', 'rotated', TTL.identity, url, headers);
    // Everything cached was fetched as somebody else, and serving it
    // back would make a corrected token look like it had not worked.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
