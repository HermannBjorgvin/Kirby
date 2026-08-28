import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCommentImage, resetCommentImageCache } from './comment-images.js';

/**
 * Attachments in pull request comments are downloaded by the *main*
 * process, from URLs written by whoever opened the pull request. So the
 * size cap is not a nicety: buffering an arbitrarily large — or
 * endless, chunked — response there takes the window and every live
 * agent PTY down with it. The cap has to hold as the body arrives, not
 * after it has all been read.
 *
 * The companion spec (comment-images.spec.ts) covers the pure
 * credential and content-type helpers.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0]);
const MAX_BYTES = 20 * 1024 * 1024;

const creds = vi.hoisted(() => ({
  ghToken: null as string | null,
  config: {} as Record<string, unknown>,
}));

vi.mock('./repo.js', () => ({ requireRepo: () => '/repo' }));
vi.mock('@kirby/vcs-core', () => ({ readConfig: () => creds.config }));
vi.mock('node:child_process', () => ({
  // Stands in for `gh auth token`.
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string) => void
  ) =>
    creds.ghToken ? cb(null, creds.ghToken + '\n') : cb(new Error('no gh'), ''),
}));

interface StubOptions {
  status?: number;
  contentType?: string | null;
  contentLength?: string | null;
  /** Chunks the body streams; omit to use `body`. */
  chunks?: Uint8Array[];
  body?: Uint8Array;
  /** Serve the body without a stream, exercising the fallback path. */
  noStream?: boolean;
}

let cancelled = 0;
let reads = 0;

function stubFetch(opts: StubOptions = {}) {
  const {
    status = 200,
    contentType = 'image/png',
    contentLength = null,
    chunks,
    body = PNG,
    noStream = false,
  } = opts;

  const headers = new Map<string, string | null>([
    ['content-type', contentType],
    ['content-length', contentLength],
  ]);

  const queue = [...(chunks ?? [body])];
  const res = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers.get(k) ?? null },
    body: noStream
      ? null
      : {
          getReader: () => ({
            read: () => {
              reads += 1;
              const value = queue.shift();
              return Promise.resolve(
                value
                  ? { done: false, value }
                  : { done: true, value: undefined }
              );
            },
            cancel: () => {
              cancelled += 1;
              return Promise.resolve();
            },
          }),
        },
    arrayBuffer: () => Promise.resolve(body.buffer),
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(res))
  );
}

beforeEach(() => {
  resetCommentImageCache();
  cancelled = 0;
  reads = 0;
  creds.ghToken = null;
  creds.config = {};
});

/** The Authorization header sent with the last request, if any. */
function sentAuth(): string | undefined {
  const mock = globalThis.fetch as unknown as {
    mock: { calls: [string, { headers: Record<string, string> }][] };
  };
  return mock.mock.calls[0]?.[1]?.headers?.authorization;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('size cap', () => {
  it('refuses before reading a body that declares itself too large', async () => {
    stubFetch({ contentLength: String(MAX_BYTES + 1) });
    await expect(
      fetchCommentImage('https://example.test/a.png')
    ).rejects.toThrow(/too large/);
    // Declared size is enough to refuse: no need to read a byte.
    expect(reads).toBe(0);
  });

  it('stops mid-stream when a body outgrows the cap, and cancels the read', async () => {
    // A content-length header is a claim, not a promise — and chunked
    // responses have none at all.
    const megabyte = new Uint8Array(1024 * 1024);
    megabyte[0] = 0x89;
    megabyte[1] = 0x50;
    stubFetch({ chunks: Array.from({ length: 25 }, () => megabyte) });

    await expect(
      fetchCommentImage('https://example.test/b.png')
    ).rejects.toThrow(/too large/);
    // Cancelled rather than left draining a hostile response.
    expect(cancelled).toBe(1);
    expect(reads).toBeLessThan(25);
  });

  it('accepts a body that stays under the cap', async () => {
    stubFetch({ chunks: [PNG.slice(0, 4), PNG.slice(4)] });
    const out = await fetchCommentImage('https://example.test/c.png');
    expect(out?.contentType).toBe('image/png');
    expect(out?.bytes).toBe(PNG.length);
    expect(out?.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('caps the no-stream fallback too', async () => {
    stubFetch({ noStream: true, body: new Uint8Array(MAX_BYTES + 1) });
    await expect(
      fetchCommentImage('https://example.test/d.png')
    ).rejects.toThrow(/too large/);
  });
});

describe('what counts as an image', () => {
  it('refuses a response that is not an image at all', async () => {
    // The renderer turns this into an <img> src; HTML here would be a
    // comment author choosing what the main process downloads.
    stubFetch({
      contentType: 'text/html',
      body: new Uint8Array([0x68, 0x74, 0x6d, 0x6c]),
    });
    await expect(
      fetchCommentImage('https://example.test/e.html')
    ).rejects.toThrow(/not an image/);
  });

  it('sniffs the type when the server does not say', async () => {
    stubFetch({ contentType: null });
    const out = await fetchCommentImage('https://example.test/f');
    expect(out?.contentType).toBe('image/png');
  });

  it('reports a failed request', async () => {
    stubFetch({ status: 404 });
    await expect(
      fetchCommentImage('https://example.test/g.png')
    ).rejects.toThrow('HTTP 404');
  });

  it('ignores a URL that is not http(s)', async () => {
    stubFetch();
    // file: and data: URLs would read the user's disk, or bypass the
    // fetch path entirely.
    expect(await fetchCommentImage('file:///etc/passwd')).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('caching', () => {
  it('downloads a repeated URL once', async () => {
    stubFetch();
    await fetchCommentImage('https://example.test/h.png');
    await fetchCommentImage('https://example.test/h.png');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('forgets a failure so a retry can succeed', async () => {
    stubFetch({ status: 500 });
    await expect(
      fetchCommentImage('https://example.test/i.png')
    ).rejects.toThrow();

    stubFetch();
    // A cached rejection would make one flaky request permanent for the
    // life of the process.
    const out = await fetchCommentImage('https://example.test/i.png');
    expect(out?.contentType).toBe('image/png');
  });
});

describe('which credential reaches which host', () => {
  /**
   * Comment bodies are written by whoever opened the pull request, and
   * the image URLs in them are theirs to choose. Attaching the user's
   * GitHub token to `https://attacker.example/pixel.png` would hand it
   * over, so host matching is a security boundary, not a convenience.
   */

  it('sends the gh token to GitHub attachment hosts', async () => {
    creds.ghToken = 'gho_secret';
    stubFetch();
    await fetchCommentImage(
      'https://user-images.githubusercontent.com/1/a.png'
    );
    expect(sentAuth()).toBe('Bearer gho_secret');
  });

  it('sends the Azure PAT as basic auth to Azure hosts', async () => {
    creds.config = { vendorAuth: { pat: 'ado_secret' } };
    stubFetch();
    await fetchCommentImage('https://dev.azure.com/org/_apis/attachment');
    expect(sentAuth()).toBe(
      `Basic ${Buffer.from(':ado_secret').toString('base64')}`
    );
  });

  it('sends nothing at all to any other host', async () => {
    creds.ghToken = 'gho_secret';
    creds.config = { vendorAuth: { pat: 'ado_secret' } };
    stubFetch();
    await fetchCommentImage('https://attacker.example/pixel.png');
    expect(sentAuth()).toBeUndefined();
  });

  it('is not fooled by a host that merely ends in the right words', async () => {
    creds.ghToken = 'gho_secret';
    stubFetch();
    // `notgithub.com` and `github.com.evil.test` are not GitHub.
    await fetchCommentImage('https://github.com.evil.test/a.png');
    expect(sentAuth()).toBeUndefined();

    resetCommentImageCache();
    stubFetch();
    await fetchCommentImage('https://notgithubusercontent.com/a.png');
    expect(sentAuth()).toBeUndefined();
  });

  it('fetches anonymously when the gh CLI has no token', async () => {
    // Signed-out users still see public images rather than an error.
    creds.ghToken = null;
    stubFetch();
    const out = await fetchCommentImage('https://github.com/a.png');
    expect(sentAuth()).toBeUndefined();
    expect(out?.contentType).toBe('image/png');
  });
});
