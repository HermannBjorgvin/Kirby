import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPrBuildRunsBatch } from './builds.js';
import { resetAdoTransport } from './request.js';

/**
 * Reading every open pull request's pipeline verdict out of one
 * listing.
 *
 * The failure this code can produce is silent and is the worst kind
 * for a CI badge: a pull request whose build went red rendering as
 * having no CI at all. It happens whenever a pull request is missing
 * from the page and the page is wrongly believed to be complete — so
 * the tests below are mostly about *absence*, and about who is
 * entitled to conclude anything from it.
 *
 * The batch response is a constructed fixture, not a recorded one
 * (see `__fixtures__/README.md`): there was no organization to record
 * from, so it is evidence about shape and not about what a real
 * server sends.
 */

const BATCH = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'builds-batch.json'), 'utf8')
) as { value: unknown[] };

const CONFIG = {
  org: 'myorg',
  project: 'myproject',
  repo: 'myrepo',
  pat: 'test-pat',
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function json(
  data: unknown,
  extraHeaders: Record<string, string> = {}
): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({
      'content-type': 'application/json',
      ...extraHeaders,
    }),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

/** Answers the repository lookup, then the builds listing. */
function serve(
  builds: unknown,
  opts: { repoId?: string | null; buildHeaders?: Record<string, string> } = {}
): void {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/build/builds'))
      return Promise.resolve(json(builds, opts.buildHeaders));
    if (/\/repositories\/myrepo\?/.test(url))
      return Promise.resolve(
        json(opts.repoId === null ? {} : { id: opts.repoId ?? 'repo-guid' })
      );
    return Promise.resolve(json({ value: [] }));
  });
}

function buildUrls(): string[] {
  return mockFetch.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/build/builds'));
}

beforeEach(() => {
  mockFetch.mockReset();
  resetAdoTransport();
});

describe('fetchPrBuildRunsBatch', () => {
  it('reads every pull request out of one listing', async () => {
    serve(BATCH);
    const verdicts = await fetchPrBuildRunsBatch(CONFIG, [101, 102, 103]);

    // 101 ran twice — the newer run is the one that speaks for it.
    expect(verdicts.get(101)).toBe('succeeded');
    expect(verdicts.get(102)).toBe('failed');
    // Still going: something is happening, no verdict yet.
    expect(verdicts.get(103)).toBe('pending');
    expect(buildUrls()).toHaveLength(1);
  });

  it('ignores builds that are not pull request builds', async () => {
    // The listing is repository-wide, so a branch build sits in it.
    // Bucketing on the merge ref is what keeps it out of a PR's verdict.
    serve(BATCH);
    const verdicts = await fetchPrBuildRunsBatch(CONFIG, [101]);
    expect(verdicts.size).toBe(1);
  });

  it('treats absence from a complete page as "no build"', async () => {
    serve(BATCH);
    const verdicts = await fetchPrBuildRunsBatch(CONFIG, [999]);
    expect(verdicts.get(999)).toBe('none');
    // No fallback query: the page was complete, so absence is an answer.
    expect(buildUrls()).toHaveLength(1);
  });

  it('falls back per pull request when the page is continued', async () => {
    // `$top` is a maximum Azure may under-deliver, and it signals more
    // with a header rather than by filling the page. Believing a short
    // page is complete is what would write "no CI" over a red build.
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('branchName='))
        return Promise.resolve(
          json({
            value: [
              {
                id: 1,
                status: 'completed',
                result: 'failed',
                definition: { id: 442 },
              },
            ],
          })
        );
      if (url.includes('/build/builds'))
        return Promise.resolve(
          json(BATCH, { 'x-ms-continuationtoken': '556770' })
        );
      if (/\/repositories\/myrepo\?/.test(url))
        return Promise.resolve(json({ id: 'repo-guid' }));
      return Promise.resolve(json({ value: [] }));
    });

    const verdicts = await fetchPrBuildRunsBatch(CONFIG, [101, 999]);
    expect(verdicts.get(101)).toBe('succeeded');
    expect(verdicts.get(999)).toBe('failed');
    // Only the row the listing could not account for is asked about.
    expect(buildUrls().filter((u) => u.includes('branchName='))).toHaveLength(
      1
    );
  });

  it('asks per pull request when the repository id cannot be resolved', async () => {
    serve(BATCH, { repoId: null });
    const verdicts = await fetchPrBuildRunsBatch(CONFIG, [101, 102]);
    // The batch needs a GUID; without one this is the old behaviour
    // rather than no answer at all.
    expect(verdicts.size).toBe(2);
    expect(buildUrls().every((u) => u.includes('branchName='))).toBe(true);
  });

  it('asks per pull request when the repository lookup fails outright', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('branchName='))
        return Promise.resolve(json({ value: [] }));
      if (/\/repositories\/myrepo\?/.test(url))
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Server Error',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as unknown as Response);
      return Promise.resolve(json({ value: [] }));
    });
    const verdicts = await fetchPrBuildRunsBatch(CONFIG, [101]);
    expect(verdicts.get(101)).toBe('none');
  });

  it('caps how many rows one cycle looks up individually', async () => {
    // The fallback is the expensive path: on a repository busy enough
    // to fill the listing, most rows miss it, and a cycle meant to cost
    // one request costs one per row. Uncapped, this is the burst that
    // gets an organization throttled.
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('branchName='))
        return Promise.resolve(
          json({
            value: [{ status: 'completed', result: 'succeeded', id: 1 }],
          })
        );
      if (url.includes('/build/builds'))
        return Promise.resolve(
          json(BATCH, { 'x-ms-continuationtoken': 'more' })
        );
      if (/\/repositories\/myrepo\?/.test(url))
        return Promise.resolve(json({ id: 'repo-guid' }));
      return Promise.resolve(json({ value: [] }));
    });

    const ids = Array.from({ length: 80 }, (_, i) => 5000 + i);
    const verdicts = await fetchPrBuildRunsBatch(CONFIG, ids);
    const separate = buildUrls().filter((u) => u.includes('branchName='));
    expect(separate).toHaveLength(25);

    // What it did not look up is *absent*, not `none`: the caller shows
    // no CI for now and asks again, where a recorded `none` would be
    // remembered as "this pull request has no build".
    expect(verdicts.size).toBe(25);
  });

  it('leaves a row out rather than calling a failed lookup "no build"', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('branchName='))
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Server Error',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as unknown as Response);
      if (url.includes('/build/builds'))
        return Promise.resolve(
          json(BATCH, { 'x-ms-continuationtoken': 'more' })
        );
      if (/\/repositories\/myrepo\?/.test(url))
        return Promise.resolve(json({ id: 'repo-guid' }));
      return Promise.resolve(json({ value: [] }));
    });

    const verdicts = await fetchPrBuildRunsBatch(CONFIG, [999]);
    // A network error is not an answer about this repository's CI.
    expect(verdicts.has(999)).toBe(false);
  });

  it('sizes the page by the repository, not by how many rows it asks about', async () => {
    // The rows a cycle asks about are the least recently read, and so
    // the least recently built — the ones least likely to be in the
    // newest page. Sizing `$top` by that handful shrinks the page to
    // its floor exactly when it needs to be widest.
    serve(BATCH);
    await fetchPrBuildRunsBatch(CONFIG, [101], 200);
    expect(buildUrls()[0]).toContain('$top=500');
  });

  it('costs nothing when there are no pull requests', async () => {
    serve(BATCH);
    expect((await fetchPrBuildRunsBatch(CONFIG, [])).size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keys its per-pull-request cache by repository', async () => {
    // Two repositories in one project can hold the same pull request
    // id; a key omitting the repository would serve one's verdict for
    // the other.
    serve(BATCH, { repoId: null });
    await fetchPrBuildRunsBatch(CONFIG, [101]);
    const first = buildUrls().length;
    await fetchPrBuildRunsBatch({ ...CONFIG, repo: 'otherrepo' }, [101]);
    expect(buildUrls().length).toBeGreaterThan(first);
  });
});
