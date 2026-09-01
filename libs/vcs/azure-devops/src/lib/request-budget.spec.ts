import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRequestCounters, resetRequestCounters } from '@kirby/vcs-core';
import { azureDevOpsProvider } from './provider.js';
import { prDetailMemo } from './pr-details.js';
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
 * The shape of a *cold* cycle, for `PR_COUNT` open pull requests:
 *
 *   1  the pull request list
 *   1  every pipeline run in the repository, indexed by merge ref
 *   N  comment threads, one per pull request (no batch endpoint)
 *   N  status list, one per pull request (no batch endpoint)
 *
 * plus, once per half hour: `/connectiondata`, the caller's teams, and
 * the repository's id.
 *
 * A *warm* cycle over pull requests that have not moved costs the list
 * and nothing else — not even the pipeline runs, which are only asked
 * for on behalf of rows whose verdict is not already known. That is
 * the whole point of `pr-details.ts`: the per-row half is what a rate
 * limit is made of, and a settled verdict on an unchanged head commit
 * is still the verdict.
 */

const PR_COUNT = 12;
const PROJECT = { org: 'myorg', project: 'myproject', repo: 'myrepo' };
const REPO_KEY = 'myorg/myproject/myrepo';
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

/** Azure reports the head of the source branch as it last merged it;
 *  that is what tells a cycle whether a pull request has moved. */
function makePrs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    pullRequestId: 100 + i,
    sourceRefName: `refs/heads/feat-${i}`,
    reviewers: [],
    lastMergeSourceCommit: { commitId: `sha-${i}` },
    lastMergeTargetCommit: { commitId: 'target-1' },
  }));
}

let prs = makePrs(PR_COUNT);

/** Statuses served for a pull request, by id. Empty unless a test says
 *  otherwise, which reads as "this repository posts no statuses". */
const statusesByPr = new Map<number, unknown[]>();

function prIdFromStatusUrl(url: string): number {
  return Number(/\/pullrequests\/(\d+)\/statuses/.exec(url)?.[1] ?? 0);
}

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
    if (url.includes('/statuses'))
      return Promise.resolve(
        json({ value: statusesByPr.get(prIdFromStatusUrl(url)) ?? [] })
      );
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
  statusesByPr.clear();
  // The fixture is shared and some tests push commits onto it, or ask
  // for a bigger repository.
  prs = makePrs(PR_COUNT);
  resetAdoTransport();
  resetRequestCounters('azure-devops');
  serveEverything();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Move the clock on, in whole minutes. */
function afterMinutes(n: number) {
  vi.setSystemTime(Date.now() + n * 60_000);
}

/** Requests spent by one more cycle. */
async function cycleCost(): Promise<number> {
  resetRequestCounters('azure-devops');
  await syncCycle();
  return counts().network;
}

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

  it('never re-reads who we are for half an hour', async () => {
    await syncCycle();
    // Identity, teams and the repository id are three of the fixed
    // handful, and none of them moves between cycles.
    afterMinutes(1);
    const urls = [] as string[];
    mockFetch.mock.calls.length = 0;
    await syncCycle();
    urls.push(...mockFetch.mock.calls.map((c) => String(c[0])));
    expect(urls.filter((u) => u.includes('/connectiondata'))).toEqual([]);
    expect(urls.filter((u) => u.includes('/teams?'))).toEqual([]);
  });
});

/**
 * The per-row half, which is the part that scales with the repository
 * and the part Azure refuses. Every figure here is a request the client
 * used to spend on an answer it already had.
 */
describe('a cycle over pull requests that have not moved', () => {
  it('costs the list, and nothing else at all', async () => {
    await syncCycle();

    // Past the transport's own 30s TTLs, so nothing here is the
    // response cache answering — it is the cycle declining to ask.
    // The builds listing goes too: it is fetched on behalf of rows
    // whose verdict is unknown, and there are none.
    afterMinutes(1);
    expect(await cycleCost()).toBe(1);
  });

  it('pays again only for the pull request whose head commit moved', async () => {
    await syncCycle();
    afterMinutes(1);
    prs[3].lastMergeSourceCommit.commitId = 'sha-3-pushed';

    // The list and the builds batch, plus that row's status list. Its
    // comment count is not a function of the commit — a push does not
    // change what people have said — so that half still stands.
    expect(await cycleCost()).toBe(2 + 1);
  });

  it('keeps asking about a pull request whose checks are still running', async () => {
    statusesByPr.set(100, [{ state: 'pending', context: { name: 'build' } }]);
    await syncCycle();
    afterMinutes(1);

    // CI in flight is the one moment the badge is worth watching, so
    // that row's status list is read every cycle — and only that row's.
    expect(await cycleCost()).toBe(2 + 1);
  });

  it('refreshes comment counts before it refreshes settled statuses', async () => {
    await syncCycle();

    // Comments are not tied to the head commit — anyone can comment at
    // any time — so they come back first, on their own. No builds
    // listing: every verdict is still known.
    afterMinutes(4);
    expect(await cycleCost()).toBe(1 + PR_COUNT);

    // And a settled verdict outlives them, until a re-run is plausible.
    afterMinutes(7);
    expect(await cycleCost()).toBe(2 + 2 * PR_COUNT);
  });

  it('bounds a cycle whatever the size of the repository', async () => {
    // Two hundred open pull requests must not mean two hundred
    // requests. The comment counts are the half that cannot be skipped
    // indefinitely, so they come round a budget at a time rather than
    // all at once — which is the shape a sliding-window rate limit
    // actually cares about.
    prs = makePrs(200);
    // The list, the runs listing, and a budget of each kind. Not four
    // hundred.
    const ceiling = 1 + 1 + 25 + 25;
    expect(await cycleCost()).toBeLessThanOrEqual(3 + ceiling);

    for (let i = 0; i < 4; i++) {
      afterMinutes(1);
      expect(await cycleCost()).toBeLessThanOrEqual(ceiling);
    }
  });

  it('shows the last count it had for a row it has no budget for', async () => {
    // Otherwise the badge blinks out on the rows the budget did not
    // reach this cycle, which looks like the comments went away.
    prs = makePrs(60);
    for (let i = 0; i < 3; i++) {
      await syncCycle();
      afterMinutes(1);
    }
    // Past the counts' life, so every row is due and most of them will
    // not be read.
    afterMinutes(4);
    const map = await syncCycle();
    const counts = Object.values(map).map((pr) => pr?.activeCommentCount);
    expect(counts).toHaveLength(60);
    expect(counts.filter((c) => c === undefined)).toEqual([]);
  });

  it('shows the last verdict it had for a row it has no budget for', async () => {
    // Same for the badge colour: a red build must not go grey because
    // this cycle's budget went to other rows.
    prs = makePrs(60);
    for (const pr of prs) {
      statusesByPr.set(pr.pullRequestId, [
        { state: 'failed', context: { name: 'build' } },
      ]);
    }
    for (let i = 0; i < 3; i++) {
      await syncCycle();
      afterMinutes(1);
    }
    // Past the verdicts' life, so every row is due and most of them
    // will not be read.
    afterMinutes(11);
    const map = await syncCycle();
    const verdicts = Object.values(map).map((pr) => pr?.buildStatus);
    expect(verdicts).toHaveLength(60);
    expect(verdicts.filter((v) => v !== 'failed')).toEqual([]);
  });

  it('keeps reading a row whose target branch moved under it', async () => {
    // Azure builds the *merge* ref, so a pull request is rebuilt when
    // main advances even though its own commit never moved. Pinning to
    // the source commit alone held a green badge over a build that had
    // since been re-queued and failed.
    await syncCycle();
    afterMinutes(1);
    for (const pr of prs) pr.lastMergeTargetCommit = { commitId: 'target-2' };
    expect(await cycleCost()).toBe(2 + PR_COUNT);
  });

  it('still shows a verdict when the build route cannot be read', async () => {
    // A token without Build (read): the runs listing 403s, so no row is
    // accounted for. The status list was still fetched and still says
    // what it says — throwing it away leaves every row reading "no CI"
    // over a repository whose checks have plainly failed.
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/pullrequests?'))
        return Promise.resolve(json({ value: prs }));
      if (url.includes('/statuses'))
        return Promise.resolve(
          json({ value: [{ state: 'failed', context: { name: 'build' } }] })
        );
      if (url.includes('/build/builds') || /\/repositories\/myrepo\?/.test(url))
        return Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as unknown as Response);
      return Promise.resolve(json({ value: [] }));
    });

    const map = await syncCycle();
    expect(Object.values(map).map((pr) => pr?.buildStatus)).toEqual(
      Array.from({ length: PR_COUNT }, () => 'failed')
    );
  });

  it('does not read the same rows forever when the build route fails', async () => {
    // Nothing is remembered in that case, so ordering has to fall back
    // to when a row was last *read*. Ordering by the answer's age
    // instead picks the same lowest ids every cycle and never reaches
    // the rest.
    prs = makePrs(60);
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/pullrequests?'))
        return Promise.resolve(json({ value: prs }));
      if (url.includes('/build/builds') || /\/repositories\/myrepo\?/.test(url))
        return Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
        } as unknown as Response);
      return Promise.resolve(json({ value: [] }));
    });

    const asked = new Set<number>();
    for (let i = 0; i < 3; i++) {
      mockFetch.mock.calls.length = 0;
      await syncCycle();
      for (const call of mockFetch.mock.calls) {
        const id = /\/pullrequests\/(\d+)\/statuses/i.exec(String(call[0]));
        if (id) asked.add(Number(id[1]));
      }
      afterMinutes(1);
    }
    expect(asked.size).toBe(60);
  });

  it('keeps a row’s badge through a push it has no budget for', async () => {
    // The row is not read this cycle, and its commit has moved, so the
    // remembered verdict is not reusable — but deleting it would blank
    // the badge until the row comes round, minutes later.
    prs = makePrs(60);
    for (const pr of prs) {
      statusesByPr.set(pr.pullRequestId, [
        { state: 'failed', context: { name: 'build' } },
      ]);
    }
    for (let i = 0; i < 3; i++) {
      await syncCycle();
      afterMinutes(1);
    }
    for (const pr of prs) pr.lastMergeSourceCommit = { commitId: 'pushed' };

    const map = await syncCycle();
    const verdicts = Object.values(map).map((pr) => pr?.buildStatus);
    expect(verdicts.filter((v) => v !== 'failed')).toEqual([]);
  });

  it('refreshes a large repository without blanking what it cannot re-read', async () => {
    prs = makePrs(60);
    for (const pr of prs) {
      statusesByPr.set(pr.pullRequestId, [
        { state: 'failed', context: { name: 'build' } },
      ]);
    }
    for (let i = 0; i < 3; i++) {
      await syncCycle();
      afterMinutes(1);
    }

    azureDevOpsProvider.forgetPullRequestCache!(PROJECT);
    const map = await syncCycle();
    // Only 25 rows can be re-read; the other 35 keep the badge they
    // had rather than going grey because the user pressed refresh.
    const verdicts = Object.values(map).map((pr) => pr?.buildStatus);
    expect(verdicts.filter((v) => v !== 'failed')).toEqual([]);
    expect(
      Object.values(map).filter((pr) => pr?.activeCommentCount === undefined)
    ).toEqual([]);
  });

  it('keeps watching a row whose checks are running, however recently read', async () => {
    // By age it sorts last — it was read a moment ago. It is also the
    // only row whose badge is actually moving, so it has to jump the
    // queue or a running build is watched no more closely than a
    // settled one.
    prs = makePrs(60);
    const running = prs[59].pullRequestId;
    statusesByPr.set(running, [{ state: 'pending', context: { name: 'ci' } }]);
    for (let i = 0; i < 3; i++) {
      await syncCycle();
      afterMinutes(1);
    }

    // Everything is due again, and 60 rows compete for 25 slots.
    afterMinutes(11);
    mockFetch.mock.calls.length = 0;
    await syncCycle();
    const asked = mockFetch.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes(`/pullrequests/${running}/statuses`));
    expect(asked).toHaveLength(1);
  });

  it('forgets a pull request that is no longer open', async () => {
    // Otherwise a long session accumulates an entry for every pull
    // request it has ever seen.
    await syncCycle();
    const closed = prs[0].pullRequestId;
    expect(prDetailMemo(REPO_KEY, closed)).toBeDefined();

    prs = prs.slice(1);
    afterMinutes(1);
    await syncCycle();
    expect(prDetailMemo(REPO_KEY, closed)).toBeUndefined();
  });

  it('comes round to every row rather than starving the tail', async () => {
    // A budget spent oldest-first has to be fair, or the rows at the
    // back of the map never get read at all and their badges are wrong
    // for as long as the app is open.
    prs = makePrs(60);
    const asked = new Set<number>();
    for (let i = 0; i < 3; i++) {
      mockFetch.mock.calls.length = 0;
      await syncCycle();
      for (const call of mockFetch.mock.calls) {
        const id = /\/pullRequests\/(\d+)\/threads/i.exec(String(call[0]));
        if (id) asked.add(Number(id[1]));
      }
      afterMinutes(1);
    }
    expect(asked.size).toBe(60);
  });

  it('goes and looks again when the user presses refresh', async () => {
    // Ten minutes is right for a poll and wrong for a button: pressing
    // refresh is the user saying they think something has changed, and
    // answering it from memory is what makes the button look broken.
    await syncCycle();
    afterMinutes(1);
    expect(await cycleCost()).toBe(1);

    azureDevOpsProvider.forgetPullRequestCache!(PROJECT);
    expect(await cycleCost()).toBe(1 + 1 + 2 * PR_COUNT);
  });

  it('leaves another repository’s rows alone when one is refreshed', async () => {
    await syncCycle();
    afterMinutes(1);

    azureDevOpsProvider.forgetPullRequestCache!({
      ...PROJECT,
      repo: 'someone-elses-repo',
    });
    // A refresh in one checkout must not make the other one cold.
    expect(await cycleCost()).toBe(1);
  });

  it('remembers nothing about a verdict it could not look up', async () => {
    // A truncated runs listing with nothing for our rows, and the
    // per-row fallback answering nothing either: the cycle does not
    // know these verdicts, so it must not remember them. Recording the
    // status list alone would show a red pipeline as green until the
    // memo ran out.
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
          json({ value: [] }, { 'x-ms-continuationtoken': 'more' })
        );
      if (/\/repositories\/myrepo\?/.test(url))
        return Promise.resolve(json({ id: 'repo-guid' }));
      return Promise.resolve(json({ value: [] }));
    });

    await syncCycle();
    afterMinutes(1);
    const urls: string[] = [];
    mockFetch.mock.calls.length = 0;
    await syncCycle();
    urls.push(...mockFetch.mock.calls.map((c) => String(c[0])));
    // It asks again rather than serving a verdict it never had.
    expect(urls.filter((u) => u.includes('/statuses'))).toHaveLength(PR_COUNT);
  });

  it('remembers nothing about a pull request with no merge identity', async () => {
    // Without one there is no way to tell a row that has not moved from
    // one that has, and a wrong guess is a badge nothing will correct.
    // Only the verdict is pinned to it, so it is the verdict that has
    // to be read again.
    for (const pr of prs) {
      pr.lastMergeSourceCommit = { commitId: '' };
      pr.lastMergeTargetCommit = { commitId: '' };
    }
    await syncCycle();
    afterMinutes(1);
    expect(await cycleCost()).toBe(2 + PR_COUNT);
  });

  it('forgets a pull request the user has just written to', async () => {
    await syncCycle();
    afterMinutes(1);
    mockFetch.mockImplementation(() => Promise.resolve(json({})));
    await azureDevOpsProvider.replyToThread!(
      AUTH,
      PROJECT,
      100,
      { id: '5' } as never,
      'a reply'
    );
    serveEverything();

    // Its comment count changed a moment ago; serving the remembered
    // one would leave the sidebar badge behind for minutes.
    expect(await cycleCost()).toBe(2 + 2);
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
