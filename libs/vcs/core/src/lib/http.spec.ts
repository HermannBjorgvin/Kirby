import { describe, expect, it } from 'vitest';
import { isVcsError, vcsErrorMessage, type VcsError } from './errors.js';
import { quotaExhausted, readJsonResponse, retryAfterMs } from './http.js';

/**
 * Reading a response without assuming it is one.
 *
 * These are the shapes that reached users as `SyntaxError: Unexpected
 * token '<'`: an HTML interstitial, a throttling refusal, a body that
 * stopped mid-object.
 */

function response(
  body: string,
  init: {
    status?: number;
    contentType?: string | null;
    headers?: Record<string, string>;
  } = {}
): Response {
  const status = init.status ?? 200;
  const headers = new Headers(init.headers ?? {});
  if (init.contentType !== null) {
    headers.set('content-type', init.contentType ?? 'application/json');
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

async function failure(promise: Promise<unknown>): Promise<VcsError> {
  try {
    await promise;
  } catch (err) {
    if (isVcsError(err)) return err;
    throw err;
  }
  throw new Error('expected a failure');
}

const opts = { providerName: 'Azure DevOps' };

describe('readJsonResponse', () => {
  it('returns the parsed body of a JSON response', async () => {
    const data = await readJsonResponse<{ n: number }>(
      response('{"n":1}'),
      opts
    );
    expect(data.n).toBe(1);
  });

  it('refuses to parse an HTML body', async () => {
    const err = await failure(
      readJsonResponse(
        response('<!DOCTYPE html><html></html>', { contentType: 'text/html' }),
        opts
      )
    );
    expect(err.kind).toBe('unexpected-response');
    expect(err.message).toBe(
      'Unexpected response from Azure DevOps (HTML, 200)'
    );
  });

  it('reads HTML as a credential failure when the provider recognises it', async () => {
    const err = await failure(
      readJsonResponse(
        response('<html>Sign in to your account</html>', {
          contentType: 'text/html',
        }),
        {
          ...opts,
          isSignInBody: (body) => body.includes('Sign in'),
        }
      )
    );
    expect(err.kind).toBe('auth');
    expect(err.message).toContain('rejected the access token');
  });

  it('names a missing content type rather than guessing', async () => {
    const err = await failure(
      readJsonResponse(response('nothing', { contentType: null }), opts)
    );
    expect(err.message).toBe(
      'Unexpected response from Azure DevOps (no content type, 200)'
    );
  });

  it('reports a truncated JSON body as an unexpected response', async () => {
    const err = await failure(readJsonResponse(response('{"value": ['), opts));
    expect(err.kind).toBe('unexpected-response');
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not-found'],
    [429, 'throttled'],
    [503, 'throttled'],
  ])('maps %i to %s', async (status, kind) => {
    const err = await failure(
      readJsonResponse(response('{}', { status }), opts)
    );
    expect(err.kind).toBe(kind);
  });

  it('decides on the status before it looks at the body', async () => {
    // A 429 that happens to carry HTML is still a 429; classifying it
    // as "unexpected HTML" would lose the wait.
    const err = await failure(
      readJsonResponse(
        response('<html>slow down</html>', {
          status: 429,
          contentType: 'text/html',
          headers: { 'retry-after': '12' },
        }),
        opts
      )
    );
    expect(err.kind).toBe('throttled');
    expect(err.retryAfterMs).toBe(12_000);
  });

  it('strips escape sequences out of the message it quotes', async () => {
    // The string lands in an Ink <Text> and in the desktop status bar;
    // a server that answers with a cursor-control sequence must not be
    // able to redraw either of them.
    const err = await failure(
      readJsonResponse(
        response(
          JSON.stringify({ message: 'TF401019:\u001b[2J\u001b[H gone' }),
          { status: 400 }
        ),
        opts
      )
    );
    expect(err.message).toBe('Azure DevOps: TF401019: gone');
  });

  it("keeps the API's own message on an error it carries one for", async () => {
    const err = await failure(
      readJsonResponse(
        response(JSON.stringify({ message: 'TF401019: no such repository' }), {
          status: 400,
        }),
        opts
      )
    );
    expect(err.kind).toBe('server');
    expect(err.message).toBe('Azure DevOps: TF401019: no such repository');
  });

  it('names the resource it could not find', async () => {
    const err = await failure(
      readJsonResponse(response('{}', { status: 404 }), {
        ...opts,
        what: 'pull request 42',
      })
    );
    expect(err.message).toBe('Azure DevOps could not find pull request 42');
  });
});

describe('retryAfterMs', () => {
  it('reads a delta in seconds', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': '30' }))).toBe(30_000);
  });

  it('reads an HTTP date, relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const headers = new Headers({
      'retry-after': new Date(now + 15_000).toUTCString(),
    });
    expect(retryAfterMs(headers, now)).toBe(15_000);
  });

  it('falls back to the rate-limit reset timestamp', () => {
    const now = 1_000_000_000_000;
    const headers = new Headers({
      'x-ratelimit-reset': String(now / 1000 + 20),
    });
    expect(retryAfterMs(headers, now)).toBe(20_000);
  });

  it('never reports a negative wait for a reset already in the past', () => {
    const now = 1_000_000_000_000;
    const headers = new Headers({
      'x-ratelimit-reset': String(now / 1000 - 60),
    });
    expect(retryAfterMs(headers, now)).toBe(0);
  });

  it('is null when the response says nothing about waiting', () => {
    expect(retryAfterMs(new Headers())).toBeNull();
  });
});

describe('blank rate-limit headers', () => {
  it('reads a present-but-empty remaining budget as absent, not as spent', () => {
    // `headers.get` answers '' for a valueless header and Number('')
    // is 0, so a gateway emitting a bare `X-RateLimit-Remaining:`
    // would stand the entire client down on every good response.
    expect(quotaExhausted(new Headers({ 'x-ratelimit-remaining': '' }))).toBe(
      false
    );
  });

  it('ignores a blank Retry-After rather than reading it as zero', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': '' }))).toBeNull();
  });

  it('ignores a blank rate-limit reset', () => {
    expect(retryAfterMs(new Headers({ 'x-ratelimit-reset': '' }))).toBeNull();
  });
});

describe('quotaExhausted', () => {
  it('is true only when the remaining budget is reported as spent', () => {
    expect(quotaExhausted(new Headers({ 'x-ratelimit-remaining': '0' }))).toBe(
      true
    );
    expect(quotaExhausted(new Headers({ 'x-ratelimit-remaining': '5' }))).toBe(
      false
    );
    // Absent is not zero — most Azure responses carry no such header.
    expect(quotaExhausted(new Headers())).toBe(false);
  });
});

describe('vcsErrorMessage', () => {
  it('passes an ordinary error through', () => {
    expect(vcsErrorMessage(new Error('boom'))).toBe('boom');
    expect(vcsErrorMessage('boom')).toBe('boom');
  });
});
