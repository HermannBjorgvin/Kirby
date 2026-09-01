import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestCounters, resetRequestCounters } from '@kirby/vcs-core';
import { azureDevOpsProvider } from './provider.js';
import { resetAdoTransport } from './request.js';

/**
 * What one sync cycle costs, in requests.
 *
 * Azure DevOps throttles per organization, so the number of requests
 * Kirby issues is a property worth asserting rather than estimating.
 * Every figure below is the reason a particular piece of the transport
 * exists, and a change that quietly reinstates a per-row call will
 * fail here rather than on someone's account.
 *
 * The shape of a cycle, for `PR_COUNT` open pull requests:
 *
 *   1  the pull request list
 *   1  every pipeline run in the repository, indexed by merge ref
 *   N  comment threads, one per pull request (no batch endpoint)
 *   N  status list, one per pull request (no batch endpoint)
 *
 * plus, once per half hour: `/connectiondata`, the caller's teams, and
 * the repository's id.
 */

const PR_COUNT = 12;
const PROJECT = { org: 'myorg', project: 'myproject', repo: 'myrepo' };
const AUTH = { pat: 'test-pat' };

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function json(
  data: unknown,
  extraHeaders: Record<string, string> = {}
): Response {
  const body = JSON.stringify(data);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({
      'content-type': 'application/json',
      ...extraHeaders,
    }),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

const prs = Array.from({ length: PR_COUNT }, (_, i) => ({
  pullRequestId: 100 + i,
  sourceRefName: `refs/heads/feat-${i}`,
  reviewers: [],
}));

/** A whole Azure organization, answering by URL. */
function serveEverything(): void {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/_apis/connectiondata'))
      return Promise.resolve(
        json({
          authenticatedUser: {
            id: 'me',
            properties: { Account: { $value: 'me@example.com' } },
          },
        })
      );
    if (url.includes('/teams?')) return Promise.resolve(json({ value: [] }));
    if (url.includes('/pullrequests?'))
      return Promise.resolve(json({ value: prs }));
    if (url.includes('/build/builds'))
      return Promise.resolve(
        json({
          value: prs.map((pr, i) => ({
            id: 900 + i,
            status: 'completed',
            result: 'succeeded',
            definition: { id: 1 },
            sourceBranch: `refs/pull/${pr.pullRequestId}/merge`,
          })),
        })
      );
    // The repository lookup: `.../git/repositories/myrepo?api-version=…`
    // with nothing after the repo name.
    if (/\/repositories\/myrepo\?/.test(url))
      return Promise.resolve(json({ id: 'repo-guid' }));
    return Promise.resolve(json({ value: [] }));
  });
}

function counts() {
  return getRequestCounters('azure-devops');
}

function syncCycle() {
  return azureDevOpsProvider.fetchPullRequests(AUTH, PROJECT);
}

beforeEach(() => {
  mockFetch.mockReset();
  resetAdoTransport();
  resetRequestCounters('azure-devops');
  serveEverything();
});

describe('one sync cycle', () => {
  it('costs 2 per pull request plus a fixed handful', async () => {
    await syncCycle();

    // 3 identity/repository reads + the list + the batched builds +
    // (threads, statuses) per pull request.
    expect(counts().network).toBe(3 + 1 + 1 + 2 * PR_COUNT);
    expect(mockFetch).toHaveBeenCalledTimes(3 + 1 + 1 + 2 * PR_COUNT);
  });

  it('asks for every pipeline run once, not once per row', async () => {
    await syncCycle();
    const buildCalls = mockFetch.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('/build/builds'));
    // The builds API takes one branch name, so a per-row query was one
    // request per open pull request. It also takes a repository, and a
    // pull request build carries the merge ref it ran against.
    expect(buildCalls).toHaveLength(1);
    expect(buildCalls[0]).toContain('repositoryId=repo-guid');
  });

  it('drops to 2 per pull request once identity is warm', async () => {
    await syncCycle();
    resetRequestCounters('azure-devops');

    // Half an hour of cycles never re-reads who we are, which team we
    // are in, or the repository's id.
    vi.setSystemTime(Date.now() + 61_000);
    await syncCycle();
    expect(counts().network).toBe(1 + 1 + 2 * PR_COUNT);
    vi.useRealTimers();
  });
});

describe('the same data asked for twice', () => {
  it('serves the review workspace from the sidebar cycle', async () => {
    await syncCycle();
    const afterCycle = counts().network;

    // Opening a pull request used to refetch the threads the sidebar
    // had just counted — per tab, on every poll.
    await azureDevOpsProvider.fetchCommentThreads!(AUTH, PROJECT, 100);
    await azureDevOpsProvider.fetchCommentThreads!(AUTH, PROJECT, 101);
    expect(counts().network).toBe(afterCycle);
    expect(counts().cached).toBeGreaterThanOrEqual(2);
  });

  it('collapses two cycles that overlap into one', async () => {
    // A forced refresh landing on top of a poll: without dedupe this
    // is two of everything, and they arrive together by definition.
    await Promise.all([syncCycle(), syncCycle()]);
    expect(counts().network).toBe(3 + 1 + 1 + 2 * PR_COUNT);
    expect(counts().deduped).toBeGreaterThan(0);
  });
});

describe('while Azure is refusing', () => {
  it('spends one request per cycle instead of one per row', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({ 'retry-after': '60' }),
      text: () => Promise.resolve(''),
    } as unknown as Response);

    await expect(syncCycle()).rejects.toThrow('throttling requests');
    // Two, not one: a cycle opens with the identity reads in parallel,
    // and the gate cannot recall a request issued before the refusal
    // arrived. What it does stop is everything after — the burst of
    // 2N+2 that used to follow, each member of it failing separately.
    expect(counts().network).toBe(2);
    expect(counts().throttled).toBeGreaterThan(0);

    // And the next cycle spends nothing at all until the wait Azure
    // named has elapsed.
    await expect(syncCycle()).rejects.toThrow('throttling requests');
    expect(counts().network).toBe(2);
  });
});
