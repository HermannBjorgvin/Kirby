import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PullRequestComments } from '@kirby/vcs-core';
import {
  deriveBuildStatus,
  combineBuildStatus,
  fetchPrBuildStatus,
} from './build-status.js';
import { deriveBuildRunStatus } from './builds.js';
import { resetAdoTransport } from './request.js';
import {
  parseReviewer,
  parsePullRequest,
  countActiveThreads,
  fetchActivePullRequests,
  fetchActiveCommentCount,
  parseAdoRemoteUrl,
  azureDevOpsProvider,
  fetchAuthenticatedUserEmail,
  fetchMyTeamIds,
  enrichReviewersWithTeamMembership,
  extractMentionGuids,
  rewriteMentions,
  _clearMentionCacheForTests,
} from './provider.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// The client reads `headers` and `text()` before it will parse
// anything, so a stand-in response has to carry both — a fake that
// only implements `json()` would skip the classification entirely and
// test nothing that ships.
function response(
  body: string,
  init: {
    status?: number;
    contentType?: string;
    headers?: Record<string, string>;
  } = {}
): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({
      'content-type': init.contentType ?? 'application/json; charset=utf-8',
      ...init.headers,
    }),
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body) as unknown),
  } as unknown as Response;
}

function jsonResponse(data: unknown, status = 200): Response {
  return response(JSON.stringify(data), { status });
}

// The transport caches and dedupes across calls by design, which
// would let one test answer another's request. Every test starts from
// an empty cache and an open throttle gate.
beforeEach(() => {
  resetAdoTransport();
});

const testAdoConfig = {
  org: 'myorg',
  project: 'myproject',
  repo: 'myrepo',
  pat: 'test-pat',
};

const testProject = {
  org: 'myorg',
  project: 'myproject',
  repo: 'myrepo',
};

describe('parseReviewer', () => {
  it('maps vote 10 to approved', () => {
    const r = parseReviewer({
      displayName: 'Alice',
      uniqueName: 'alice@example.com',
      vote: 10,
    });
    expect(r).toEqual({
      displayName: 'Alice',
      identifier: 'alice@example.com',
      decision: 'approved',
    });
  });

  it('maps vote 5 to approved', () => {
    expect(parseReviewer({ vote: 5 }).decision).toBe('approved');
  });

  it('maps vote -5 to waiting-for-author', () => {
    expect(parseReviewer({ vote: -5 }).decision).toBe('waiting-for-author');
  });

  it('maps vote -10 to rejected', () => {
    expect(parseReviewer({ vote: -10 }).decision).toBe('rejected');
  });

  it('maps vote 0 to no-response', () => {
    expect(parseReviewer({ vote: 0 }).decision).toBe('no-response');
  });

  it('maps hasDeclined to declined', () => {
    expect(parseReviewer({ vote: 0, hasDeclined: true }).decision).toBe(
      'declined'
    );
  });

  it('defaults missing fields', () => {
    expect(parseReviewer({})).toEqual({
      displayName: 'Unknown',
      identifier: '',
      decision: 'no-response',
    });
  });

  it('normalizes invalid vote to no-response', () => {
    expect(parseReviewer({ displayName: 'Bob', vote: 7 }).decision).toBe(
      'no-response'
    );
  });
});

describe('parsePullRequest', () => {
  it('parses a full PR', () => {
    const result = parsePullRequest(
      {
        pullRequestId: 42,
        title: 'Add feature X',
        sourceRefName: 'refs/heads/feature/my-branch',
        targetRefName: 'refs/heads/main',
        isDraft: true,
        reviewers: [
          { displayName: 'Alice', uniqueName: 'alice@example.com', vote: 10 },
        ],
        createdBy: {
          uniqueName: 'bob@example.com',
          displayName: 'Bob Builder',
        },
      },
      testProject
    );
    expect(result).toEqual({
      id: 42,
      title: 'Add feature X',
      sourceBranch: 'feature/my-branch',
      targetBranch: 'main',
      isDraft: true,
      reviewers: [
        {
          displayName: 'Alice',
          identifier: 'alice@example.com',
          decision: 'approved',
        },
      ],
      createdByIdentifier: 'bob@example.com',
      createdByDisplayName: 'Bob Builder',
      url: 'https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/42',
    });
  });

  it('strips refs/heads/ prefix from both branches', () => {
    const result = parsePullRequest(
      {
        sourceRefName: 'refs/heads/main',
        targetRefName: 'refs/heads/develop',
      },
      testProject
    );
    expect(result.sourceBranch).toBe('main');
    expect(result.targetBranch).toBe('develop');
  });

  it('defaults missing fields', () => {
    const result = parsePullRequest({}, testProject);
    expect(result).toEqual({
      id: 0,
      title: '',
      sourceBranch: '',
      targetBranch: '',
      isDraft: false,
      reviewers: [],
      createdByIdentifier: '',
      createdByDisplayName: '',
      url: 'https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/0',
    });
  });

  it('extracts createdBy fields', () => {
    const result = parsePullRequest(
      {
        pullRequestId: 99,
        sourceRefName: 'refs/heads/feature/test',
        createdBy: {
          uniqueName: 'user@example.com',
          displayName: 'Test User',
        },
      },
      testProject
    );
    expect(result.createdByIdentifier).toBe('user@example.com');
    expect(result.createdByDisplayName).toBe('Test User');
  });
});

describe('countActiveThreads', () => {
  it('counts active threads with human comments', () => {
    const threads = [
      { status: 'active', comments: [{ commentType: 'text' }] },
      {
        status: 'active',
        comments: [{ commentType: 'text' }, { commentType: 'system' }],
      },
    ];
    expect(countActiveThreads(threads)).toBe(2);
  });

  it('ignores resolved threads', () => {
    const threads = [
      { status: 'fixed', comments: [{ commentType: 'text' }] },
      { status: 'closed', comments: [{ commentType: 'text' }] },
    ];
    expect(countActiveThreads(threads)).toBe(0);
  });

  it('ignores system-only threads', () => {
    const threads = [
      { status: 'active', comments: [{ commentType: 'system' }] },
    ];
    expect(countActiveThreads(threads)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(countActiveThreads([])).toBe(0);
  });

  it('handles threads with no comments', () => {
    expect(countActiveThreads([{ status: 'active' }])).toBe(0);
  });
});

describe('deriveBuildStatus', () => {
  it('returns succeeded when all statuses are succeeded', () => {
    expect(
      deriveBuildStatus([{ state: 'succeeded' }, { state: 'succeeded' }])
    ).toBe('succeeded');
  });

  it('returns failed when any status is failed', () => {
    expect(
      deriveBuildStatus([{ state: 'succeeded' }, { state: 'failed' }])
    ).toBe('failed');
  });

  it('returns failed when any status is error', () => {
    expect(
      deriveBuildStatus([{ state: 'succeeded' }, { state: 'error' }])
    ).toBe('failed');
  });

  it('returns pending when mix of succeeded and pending', () => {
    expect(
      deriveBuildStatus([{ state: 'succeeded' }, { state: 'pending' }])
    ).toBe('pending');
  });

  it('returns pending for notSet state', () => {
    expect(deriveBuildStatus([{ state: 'notSet' }])).toBe('pending');
  });

  it('returns none for empty array', () => {
    expect(deriveBuildStatus([])).toBe('none');
  });

  it('ignores notApplicable statuses', () => {
    expect(deriveBuildStatus([{ state: 'notApplicable' }])).toBe('none');
  });

  it('returns succeeded when notApplicable mixed with succeeded', () => {
    expect(
      deriveBuildStatus([{ state: 'notApplicable' }, { state: 'succeeded' }])
    ).toBe('succeeded');
  });

  /**
   * Azure appends to a pull request's status list instead of replacing
   * entries, so the history of a check is all present at once. Counting
   * every entry made a single failure permanent: a pull request that
   * failed and was then fixed reported `failed` until it was merged, and
   * refreshing could never clear it because the response really did
   * still contain the failure.
   *
   * These are all about which entry speaks for a check. The cases above
   * stay valid — statuses with no context are distinct checks, and each
   * still gets its own vote.
   */
  const ci = { genre: 'continuous-integration', name: 'build' };
  const cd = { genre: 'continuous-integration', name: 'deploy' };

  it('lets a re-run supersede the failure it replaced', () => {
    expect(
      deriveBuildStatus([
        {
          state: 'failed',
          context: ci,
          id: 1,
          creationDate: '2026-01-01T10:00:00Z',
        },
        {
          state: 'succeeded',
          context: ci,
          id: 2,
          creationDate: '2026-01-01T11:00:00Z',
        },
      ])
    ).toBe('succeeded');
  });

  it('does not let an old success mask a current failure', () => {
    // The same ordering hazard in the other direction: newest wins,
    // whichever way the check went.
    expect(
      deriveBuildStatus([
        {
          state: 'succeeded',
          context: ci,
          id: 1,
          creationDate: '2026-01-01T10:00:00Z',
        },
        {
          state: 'failed',
          context: ci,
          id: 2,
          creationDate: '2026-01-01T11:00:00Z',
        },
      ])
    ).toBe('failed');
  });

  it('is not fooled by the newest entry arriving first in the list', () => {
    // Azure does not promise an order, so position must not decide it.
    expect(
      deriveBuildStatus([
        {
          state: 'succeeded',
          context: ci,
          id: 2,
          creationDate: '2026-01-01T11:00:00Z',
        },
        {
          state: 'failed',
          context: ci,
          id: 1,
          creationDate: '2026-01-01T10:00:00Z',
        },
      ])
    ).toBe('succeeded');
  });

  it('keeps one vote per check, so a second check still counts', () => {
    // Deduping must not collapse genuinely different checks: the fixed
    // build should not hide the deploy that is still failing.
    expect(
      deriveBuildStatus([
        {
          state: 'failed',
          context: ci,
          id: 1,
          creationDate: '2026-01-01T10:00:00Z',
        },
        {
          state: 'succeeded',
          context: ci,
          id: 3,
          creationDate: '2026-01-01T12:00:00Z',
        },
        {
          state: 'failed',
          context: cd,
          id: 2,
          creationDate: '2026-01-01T11:00:00Z',
        },
      ])
    ).toBe('failed');
  });

  it('prefers the later iteration even when the stale run reported last', () => {
    // A new push re-runs the check, and the previous iteration's verdict
    // is about code that is no longer there. A slow pipeline can post
    // that stale verdict after the new one, giving it the higher id —
    // so the iteration has to outrank both the id and the clock, or
    // finishing an old run turns a good pull request red.
    expect(
      deriveBuildStatus([
        {
          state: 'succeeded',
          context: ci,
          iterationId: 2,
          id: 5,
          creationDate: '2026-01-01T11:00:00Z',
        },
        {
          state: 'failed',
          context: ci,
          iterationId: 1,
          id: 9,
          creationDate: '2026-01-01T12:00:00Z',
        },
      ])
    ).toBe('succeeded');
  });

  it('orders by date when there are no ids to compare', () => {
    expect(
      deriveBuildStatus([
        { state: 'failed', context: ci, creationDate: '2026-01-01T11:00:00Z' },
        {
          state: 'succeeded',
          context: ci,
          creationDate: '2026-01-01T12:00:00Z',
        },
      ])
    ).toBe('succeeded');
  });

  it('falls back to the id when two entries share a timestamp', () => {
    // A fast pipeline can post twice inside the same second.
    const at = '2026-01-01T10:00:00Z';
    expect(
      deriveBuildStatus([
        { state: 'failed', context: ci, id: 1, creationDate: at },
        { state: 'succeeded', context: ci, id: 2, creationDate: at },
      ])
    ).toBe('succeeded');
  });

  it('groups on the whole context, not just the name', () => {
    // Same name under a different genre is a different check.
    expect(
      deriveBuildStatus([
        { state: 'succeeded', context: { genre: 'a', name: 'check' }, id: 2 },
        { state: 'failed', context: { genre: 'b', name: 'check' }, id: 1 },
      ])
    ).toBe('failed');
  });

  it('lets notApplicable retract the same check’s earlier verdict', () => {
    // Taken from a real pull request: a coverage check failed on the
    // first iteration and then reported "not applicable" on the second.
    // Its last word is that it does not apply, so it should leave no
    // mark at all rather than the failure standing.
    expect(
      deriveBuildStatus([
        { state: 'failed', context: ci, id: 3, iterationId: 1 },
        { state: 'notApplicable', context: ci, id: 5, iterationId: 2 },
      ])
    ).toBe('none');
  });

  it('does not let notApplicable silence a different check', () => {
    // Retraction is scoped to the check that issued it.
    expect(
      deriveBuildStatus([
        { state: 'notApplicable', context: ci, id: 2 },
        { state: 'failed', context: cd, id: 1 },
      ])
    ).toBe('failed');
  });

  it('treats a missing state as queued, not as no result', () => {
    // Azure omits `state` when it is `notSet` (zero in its enum); those
    // entries are the ones describing a check that has been queued.
    expect(deriveBuildStatus([{ state: undefined, context: ci, id: 1 }])).toBe(
      'pending'
    );
  });

  /**
   * A real response, recorded from a pull request that showed red in
   * Kirby while Azure showed nothing wrong, then anonymised. It is one
   * coverage check reporting five times across two iterations: queued
   * twice, failed on iteration 1, pending on iteration 2, and finally
   * not applicable — so the failure it is remembered by belongs to code
   * that has since been replaced, and the check has since withdrawn.
   *
   * Kept as a file rather than hand-written objects because the details
   * that broke us are the ones nobody thinks to invent: `state` missing
   * altogether on the queued entries, two iterations interleaved, and a
   * retraction arriving one second after a pending.
   */
  it('reads a recorded Azure response the way Azure does', () => {
    // Read rather than imported: keeping it out of the module graph
    // means the recording stays a data file, with no bearing on how the
    // project compiles.
    const recorded = JSON.parse(
      readFileSync(
        new URL(
          './__fixtures__/pr-statuses-failed-then-not-applicable.json',
          import.meta.url
        ),
        'utf8'
      )
    ) as { value: Parameters<typeof deriveBuildStatus>[0] };

    expect(deriveBuildStatus(recorded.value)).toBe('none');
  });

  it('follows one check through four iterations to its withdrawal', () => {
    // A second recording, from a pull request whose coverage check ran
    // on every push: failed twice on iterations it has since moved past,
    // went pending on the current one, then withdrew a second later.
    // Ten entries, one context, and the only thing that speaks for the
    // check is its last word.
    const recorded = JSON.parse(
      readFileSync(
        new URL(
          './__fixtures__/pr-statuses-four-iterations-withdrawn.json',
          import.meta.url
        ),
        'utf8'
      )
    ) as { value: Parameters<typeof deriveBuildStatus>[0] };

    expect(recorded.value).toHaveLength(10);
    expect(deriveBuildStatus(recorded.value)).toBe('none');
  });

  it('still counts context-less entries separately', () => {
    // Nothing to group on, so the pre-existing behaviour holds.
    expect(
      deriveBuildStatus([{ state: 'succeeded' }, { state: 'failed' }])
    ).toBe('failed');
  });
});

/**
 * Pipeline runs, the other half of a pull request's CI.
 *
 * Azure builds a pull request against `refs/pull/{id}/merge`, and this
 * repository reports CI that way while posting only a coverage check to
 * the status list — a check that withdraws when the build fails, since
 * a failed build produces nothing to measure. Reading the statuses
 * alone therefore reported "no CI result" for a pull request that was
 * plainly red.
 */
describe('deriveBuildRunStatus', () => {
  const run = (over: Record<string, unknown> = {}) => ({
    id: 1,
    status: 'completed',
    result: 'succeeded',
    definition: { id: 442, name: 'nx' },
    ...over,
  });

  it('reads a completed run by its result', () => {
    expect(deriveBuildRunStatus([run()])).toBe('succeeded');
    expect(deriveBuildRunStatus([run({ result: 'failed' })])).toBe('failed');
  });

  it('treats a run that has not finished as in progress', () => {
    expect(deriveBuildRunStatus([run({ status: 'inProgress' })])).toBe(
      'pending'
    );
    expect(
      deriveBuildRunStatus([run({ status: 'notStarted', result: undefined })])
    ).toBe('pending');
  });

  it('does not call a partial success green', () => {
    // Something in the pipeline broke; there is no warning state to put
    // it in, and green would hide it.
    expect(deriveBuildRunStatus([run({ result: 'partiallySucceeded' })])).toBe(
      'failed'
    );
  });

  it('draws no conclusion from a cancelled run', () => {
    expect(deriveBuildRunStatus([run({ result: 'canceled' })])).toBe('none');
  });

  it('lets a re-run supersede the failure it replaced', () => {
    // Same hazard as the status list: a definition that ran twice must
    // be spoken for by its newest run only.
    expect(
      deriveBuildRunStatus([
        run({ id: 10, result: 'failed' }),
        run({ id: 20, result: 'succeeded' }),
      ])
    ).toBe('succeeded');
  });

  it('keeps one verdict per definition', () => {
    // A green pipeline must not hide a different one that is red.
    expect(
      deriveBuildRunStatus([
        run({ id: 20, result: 'succeeded', definition: { id: 1, name: 'a' } }),
        run({ id: 10, result: 'failed', definition: { id: 2, name: 'b' } }),
      ])
    ).toBe('failed');
  });

  it('returns none when nothing ran', () => {
    expect(deriveBuildRunStatus([])).toBe('none');
  });

  it('reads a recorded failing build', () => {
    const recorded = JSON.parse(
      readFileSync(
        new URL('./__fixtures__/pr-builds-failed.json', import.meta.url),
        'utf8'
      )
    ) as { value: Parameters<typeof deriveBuildRunStatus>[0] };
    expect(deriveBuildRunStatus(recorded.value)).toBe('failed');
  });
});

describe('combineBuildStatus', () => {
  it('lets a failure on either route win', () => {
    expect(combineBuildStatus('failed', 'succeeded')).toBe('failed');
    expect(combineBuildStatus('succeeded', 'failed')).toBe('failed');
    expect(combineBuildStatus('none', 'failed')).toBe('failed');
  });

  it('reports work in progress ahead of a success', () => {
    expect(combineBuildStatus('succeeded', 'pending')).toBe('pending');
  });

  it('reports a success over silence', () => {
    expect(combineBuildStatus('none', 'succeeded')).toBe('succeeded');
  });

  it('stays silent only when both routes are', () => {
    expect(combineBuildStatus('none', 'none')).toBe('none');
  });

  it('surfaces the failing build behind a withdrawn coverage check', () => {
    // The recorded pair from the pull request that reported no CI while
    // failing: the statuses withdrew seconds after the build went red.
    const statuses = JSON.parse(
      readFileSync(
        new URL(
          './__fixtures__/pr-statuses-withdrawn-after-build-failure.json',
          import.meta.url
        ),
        'utf8'
      )
    ) as { value: Parameters<typeof deriveBuildStatus>[0] };
    const builds = JSON.parse(
      readFileSync(
        new URL('./__fixtures__/pr-builds-failed.json', import.meta.url),
        'utf8'
      )
    ) as { value: Parameters<typeof deriveBuildRunStatus>[0] };

    expect(deriveBuildStatus(statuses.value)).toBe('none');
    expect(
      combineBuildStatus(
        deriveBuildStatus(statuses.value),
        deriveBuildRunStatus(builds.value)
      )
    ).toBe('failed');
  });
});

describe('fetchActivePullRequests', () => {
  beforeEach(() => {
    // Block body on purpose: an arrow returning the mock hands vitest
    // a "cleanup hook", which it then calls — invoking fetch with no
    // arguments at teardown.
    mockFetch.mockReset();
  });

  it('calls correct URL and returns parsed PRs', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        value: [
          {
            pullRequestId: 42,
            sourceRefName: 'refs/heads/my-feature',
            isDraft: false,
            reviewers: [{ displayName: 'Alice', vote: 10 }],
          },
        ],
      })
    );

    const result = await fetchActivePullRequests(testAdoConfig, testProject);

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain(
      'myorg/myproject/_apis/git/repositories/myrepo/pullrequests'
    );
    expect(calledUrl).toContain('searchCriteria.status=active');
    expect(result).toHaveLength(1);
    expect(result[0]!.sourceBranch).toBe('my-feature');
  });

  it('reports a rejected token as a rejected token', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 401));
    await expect(
      fetchActivePullRequests(testAdoConfig, testProject)
    ).rejects.toThrow('Azure DevOps rejected the access token');
  });

  it('sends Basic auth header', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ value: [] }));
    await fetchActivePullRequests(testAdoConfig, testProject);

    const headers = mockFetch.mock.calls[0]![1]?.headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toMatch(/^Basic /);
    const decoded = Buffer.from(
      headers.Authorization.replace('Basic ', ''),
      'base64'
    ).toString();
    expect(decoded).toBe(':test-pat');
  });
});

describe('fetchActiveCommentCount', () => {
  beforeEach(() => {
    // Block body on purpose: an arrow returning the mock hands vitest
    // a "cleanup hook", which it then calls — invoking fetch with no
    // arguments at teardown.
    mockFetch.mockReset();
  });

  it('returns count of active non-system threads', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        value: [
          { status: 'active', comments: [{ commentType: 'text' }] },
          { status: 'active', comments: [{ commentType: 'system' }] },
          { status: 'fixed', comments: [{ commentType: 'text' }] },
        ],
      })
    );

    const count = await fetchActiveCommentCount(testAdoConfig, 42);
    expect(count).toBe(1);

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('/pullrequests/42/threads');
  });
});

describe('fetchPrBuildStatus', () => {
  beforeEach(() => {
    // Block body on purpose: an arrow returning the mock hands vitest
    // a "cleanup hook", which it then calls — invoking fetch with no
    // arguments at teardown.
    mockFetch.mockReset();
  });

  it('calls correct URL and returns derived build status', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        value: [{ state: 'succeeded' }, { state: 'pending' }],
      })
    );

    const result = await fetchPrBuildStatus(testAdoConfig, 42);
    expect(result).toBe('pending');

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('/pullrequests/42/statuses');
  });

  it('reports a forbidden response as a rejected token', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 403));
    await expect(fetchPrBuildStatus(testAdoConfig, 42)).rejects.toThrow(
      'Azure DevOps rejected the access token'
    );
  });
});

describe('parseAdoRemoteUrl', () => {
  it('parses HTTPS URL', () => {
    expect(
      parseAdoRemoteUrl('https://dev.azure.com/myorg/myproject/_git/myrepo')
    ).toEqual({ org: 'myorg', project: 'myproject', repo: 'myrepo' });
  });

  it('parses HTTPS URL with username prefix', () => {
    expect(
      parseAdoRemoteUrl(
        'https://myorg@dev.azure.com/myorg/myproject/_git/myrepo'
      )
    ).toEqual({ org: 'myorg', project: 'myproject', repo: 'myrepo' });
  });

  it('parses SSH URL', () => {
    expect(
      parseAdoRemoteUrl('git@ssh.dev.azure.com:v3/myorg/myproject/myrepo')
    ).toEqual({ org: 'myorg', project: 'myproject', repo: 'myrepo' });
  });

  it('strips .git suffix', () => {
    const result = parseAdoRemoteUrl(
      'https://dev.azure.com/myorg/myproject/_git/myrepo.git'
    );
    expect(result!.repo).toBe('myrepo');
  });

  it('returns null for non-ADO URLs', () => {
    expect(parseAdoRemoteUrl('https://github.com/user/repo.git')).toBeNull();
    expect(parseAdoRemoteUrl('git@github.com:user/repo.git')).toBeNull();
    expect(parseAdoRemoteUrl('not a url')).toBeNull();
  });
});

describe('enrichReviewersWithTeamMembership', () => {
  const userEmail = 'alice@example.com';
  const teamId = 'team-guid-123';
  const myTeamIds = new Set([teamId]);

  it('adds synthetic reviewer when team matches', () => {
    const reviewers = [
      {
        displayName: 'My Team',
        uniqueName: 'vstfs:///Classification/TeamProject/team-guid-123',
        id: teamId,
        vote: 0,
        isContainer: true,
      },
    ];
    const result = enrichReviewersWithTeamMembership(
      reviewers,
      myTeamIds,
      userEmail
    );
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      displayName: 'My Team',
      uniqueName: userEmail,
      vote: 0,
      hasDeclined: undefined,
      isContainer: false,
    });
  });

  it('skips when user is already an explicit reviewer', () => {
    const reviewers = [
      {
        displayName: 'My Team',
        id: teamId,
        vote: 0,
        isContainer: true,
      },
      {
        displayName: 'Alice',
        uniqueName: 'alice@example.com',
        vote: 5,
        isContainer: false,
      },
    ];
    const result = enrichReviewersWithTeamMembership(
      reviewers,
      myTeamIds,
      userEmail
    );
    expect(result).toEqual(reviewers);
  });

  it('skips when team id does not match', () => {
    const reviewers = [
      {
        displayName: 'Other Team',
        id: 'other-team-guid',
        vote: 0,
        isContainer: true,
      },
    ];
    const result = enrichReviewersWithTeamMembership(
      reviewers,
      myTeamIds,
      userEmail
    );
    expect(result).toHaveLength(1);
  });

  it('returns original array when myTeamIds is empty', () => {
    const reviewers = [
      { displayName: 'Team', id: teamId, vote: 0, isContainer: true },
    ];
    const result = enrichReviewersWithTeamMembership(
      reviewers,
      new Set(),
      userEmail
    );
    expect(result).toBe(reviewers);
  });

  it('returns original array when userEmail is empty', () => {
    const reviewers = [
      { displayName: 'Team', id: teamId, vote: 0, isContainer: true },
    ];
    const result = enrichReviewersWithTeamMembership(reviewers, myTeamIds, '');
    expect(result).toBe(reviewers);
  });
});

describe('fetchAuthenticatedUserEmail', () => {
  beforeEach(() => {
    // Block body on purpose: an arrow returning the mock hands vitest
    // a "cleanup hook", which it then calls — invoking fetch with no
    // arguments at teardown.
    mockFetch.mockReset();
  });

  it('returns user email on success', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        authenticatedUser: {
          properties: { Account: { $value: 'alice@example.com' } },
        },
      })
    );
    const email = await fetchAuthenticatedUserEmail(testAdoConfig);
    expect(email).toBe('alice@example.com');
    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('/_apis/connectiondata');
  });

  it('reports a rejected token as a rejected token', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 401));
    await expect(fetchAuthenticatedUserEmail(testAdoConfig)).rejects.toThrow(
      'Azure DevOps rejected the access token'
    );
  });
});

describe('fetchMyTeamIds', () => {
  beforeEach(() => {
    // Block body on purpose: an arrow returning the mock hands vitest
    // a "cleanup hook", which it then calls — invoking fetch with no
    // arguments at teardown.
    mockFetch.mockReset();
  });

  it('returns team IDs on success', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        value: [{ id: 'team-1' }, { id: 'team-2' }],
      })
    );
    const ids = await fetchMyTeamIds(testAdoConfig);
    expect(ids).toEqual(new Set(['team-1', 'team-2']));
    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('$mine=true');
  });

  it('returns empty set on error response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 403));
    const ids = await fetchMyTeamIds(testAdoConfig);
    expect(ids).toEqual(new Set());
  });

  it('returns empty set on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));
    const ids = await fetchMyTeamIds(testAdoConfig);
    expect(ids).toEqual(new Set());
  });
});

describe('azureDevOpsProvider', () => {
  it('has correct id and displayName', () => {
    expect(azureDevOpsProvider.id).toBe('azure-devops');
    expect(azureDevOpsProvider.displayName).toBe('Azure DevOps');
  });

  it('isConfigured returns true when all fields set', () => {
    expect(
      azureDevOpsProvider.isConfigured(
        { pat: 'token' },
        { org: 'o', project: 'p', repo: 'r' }
      )
    ).toBe(true);
  });

  it('isConfigured returns false when pat missing', () => {
    expect(
      azureDevOpsProvider.isConfigured(
        {},
        { org: 'o', project: 'p', repo: 'r' }
      )
    ).toBe(false);
  });

  it('isConfigured returns false when project field missing', () => {
    expect(
      azureDevOpsProvider.isConfigured({ pat: 'token' }, { org: 'o' })
    ).toBe(false);
  });

  it('matchesUser is case-insensitive', () => {
    expect(
      azureDevOpsProvider.matchesUser('Alice@Example.com', {
        email: 'alice@example.com',
        vendorAuth: {},
        vendorProject: {},
      })
    ).toBe(true);
  });

  it('matchesUser returns false when email is missing', () => {
    expect(
      azureDevOpsProvider.matchesUser('alice@example.com', {
        vendorAuth: {},
        vendorProject: {},
      })
    ).toBe(false);
  });

  it('parseRemoteUrl delegates to parseAdoRemoteUrl', () => {
    expect(
      azureDevOpsProvider.parseRemoteUrl('https://dev.azure.com/o/p/_git/r')
    ).toEqual({ org: 'o', project: 'p', repo: 'r' });
    expect(
      azureDevOpsProvider.parseRemoteUrl('https://github.com/u/r')
    ).toBeNull();
  });

  it('getPullRequestUrl constructs correct URL', () => {
    expect(
      azureDevOpsProvider.getPullRequestUrl(
        { org: 'myorg', project: 'myproject', repo: 'myrepo' },
        42
      )
    ).toBe('https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/42');
  });

  describe('fetchPullRequests', () => {
    beforeEach(() => {
      // Block body on purpose: an arrow returning the mock hands vitest
      // a "cleanup hook", which it then calls — invoking fetch with no
      // arguments at teardown.
      mockFetch.mockReset();
    });

    it('returns a map of branch to PR info with comment counts', async () => {
      // Answered by URL, not in call order: the provider dedupes and
      // batches, so which request goes out when is an implementation
      // detail this test has no business pinning down.
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/_apis/connectiondata'))
          return Promise.resolve(
            jsonResponse({
              authenticatedUser: {
                properties: { Account: { $value: 'me@example.com' } },
              },
            })
          );
        if (url.includes('/pullrequests?'))
          return Promise.resolve(
            jsonResponse({
              value: [
                {
                  pullRequestId: 42,
                  sourceRefName: 'refs/heads/feat-a',
                  isDraft: false,
                  reviewers: [{ displayName: 'Alice', vote: 10 }],
                },
                {
                  pullRequestId: 43,
                  sourceRefName: 'refs/heads/feat-b',
                  isDraft: true,
                  reviewers: [],
                },
              ],
            })
          );
        if (url.includes('/pullrequests/42/threads'))
          return Promise.resolve(
            jsonResponse({
              value: [
                { status: 'active', comments: [{ commentType: 'text' }] },
                { status: 'active', comments: [{ commentType: 'text' }] },
              ],
            })
          );
        if (url.includes('/pullrequests/42/statuses'))
          return Promise.resolve(
            jsonResponse({ value: [{ state: 'succeeded' }] })
          );
        if (url.includes('/pullrequests/43/statuses'))
          return Promise.resolve(
            jsonResponse({ value: [{ state: 'failed' }] })
          );
        return Promise.resolve(jsonResponse({ value: [] }));
      });

      const result = await azureDevOpsProvider.fetchPullRequests(
        { pat: 'test-pat' },
        testProject
      );

      expect(result['feat-a']).toEqual({
        id: 42,
        title: '',
        sourceBranch: 'feat-a',
        targetBranch: '',
        isDraft: false,
        reviewers: [
          {
            displayName: 'Alice',
            identifier: '',
            decision: 'approved',
          },
        ],
        activeCommentCount: 2,
        buildStatus: 'succeeded',
        createdByIdentifier: '',
        createdByDisplayName: '',
        url: 'https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/42',
      });
      expect(result['feat-b']).toEqual({
        id: 43,
        title: '',
        sourceBranch: 'feat-b',
        targetBranch: '',
        isDraft: true,
        reviewers: [],
        activeCommentCount: 0,
        buildStatus: 'failed',
        createdByIdentifier: '',
        createdByDisplayName: '',
        url: 'https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/43',
      });
    });
  });

  // Placed after the ordered test above: this one warms the
  // provider's module-level identity cache, which would otherwise
  // let that test skip two fetches and misalign its queue.
  it('reports a failing pipeline even when the status list is clean', async () => {
    // The reported bug: a pull request showed no CI result while its
    // build was red. The coverage check that posts statuses withdraws
    // when the build fails, so the status list alone says nothing.
    //
    // Answers by URL rather than in call order: the provider caches
    // identity lookups between tests, so how many calls precede these
    // is not something a test should depend on.
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('connectionData'))
        return Promise.resolve(
          jsonResponse({
            authenticatedUser: {
              properties: { Account: { $value: 'me@example.com' } },
            },
          })
        );
      if (url.includes('/pullrequests?'))
        return Promise.resolve(
          jsonResponse({
            value: [
              {
                pullRequestId: 77013,
                sourceRefName: 'refs/heads/feat-a',
                isDraft: false,
                reviewers: [],
              },
            ],
          })
        );
      if (url.includes('/statuses'))
        return Promise.resolve(
          jsonResponse({ value: [{ state: 'notApplicable' }] })
        );
      if (url.includes('/build/builds'))
        return Promise.resolve(
          jsonResponse({
            value: [
              {
                id: 556771,
                status: 'completed',
                result: 'failed',
                definition: { id: 442, name: 'nx' },
              },
            ],
          })
        );
      return Promise.resolve(jsonResponse({ value: [] }));
    });

    const result = await azureDevOpsProvider.fetchPullRequests(
      { pat: 'test-pat' },
      testProject
    );
    expect(result['feat-a']?.buildStatus).toBe('failed');

    // and it asked the merge ref, not the source branch, which is
    // where Azure actually builds a pull request
    const urls = mockFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('refs%2Fpull%2F77013%2Fmerge'))).toBe(
      true
    );
  });

  // ── Mention rewriting ─────────────────────────────────────────
  //
  // ADO's REST API returns raw `@<GUID>` tokens in comment bodies
  // instead of the display names the web UI renders. Kirby
  // post-processes each body via the Identities API and replaces
  // resolved GUIDs inline; unresolved ones stay intact so nothing
  // silently disappears.

  describe('extractMentionGuids', () => {
    it('picks up a single @<guid> mention', () => {
      const guids = extractMentionGuids(
        'ping @<12345678-1234-1234-1234-123456789012> pls review'
      );
      expect(guids).toEqual(['12345678-1234-1234-1234-123456789012']);
    });

    it('dedupes repeats', () => {
      const g = '12345678-1234-1234-1234-123456789012';
      const guids = extractMentionGuids(`hi @<${g}> and also @<${g}>`);
      expect(guids).toEqual([g]);
    });

    it('returns [] for text without mentions', () => {
      expect(extractMentionGuids('just a plain comment')).toEqual([]);
    });

    it('is case-insensitive on hex digits', () => {
      const guids = extractMentionGuids(
        '@<12345678-ABCD-1234-1234-123456789ABC>'
      );
      expect(guids).toEqual(['12345678-abcd-1234-1234-123456789abc']);
    });

    it('ignores bracketed non-GUID content', () => {
      expect(extractMentionGuids('@<not-a-guid> and @<foo>')).toEqual([]);
    });
  });

  describe('rewriteMentions', () => {
    const g1 = '11111111-1111-1111-1111-111111111111';
    const g2 = '22222222-2222-2222-2222-222222222222';

    it('substitutes @<guid> with @<displayName> when resolved', () => {
      const cache = new Map([[g1, 'Alice Smith']]);
      expect(rewriteMentions(`hey @<${g1}> check`, cache)).toBe(
        'hey @Alice Smith check'
      );
    });

    it('leaves unresolved guids intact', () => {
      const cache = new Map<string, string>();
      expect(rewriteMentions(`hey @<${g1}>`, cache)).toBe(`hey @<${g1}>`);
    });

    it('handles multiple different mentions', () => {
      const cache = new Map([
        [g1, 'Alice'],
        [g2, 'Bob'],
      ]);
      expect(rewriteMentions(`@<${g1}> and @<${g2}>`, cache)).toBe(
        '@Alice and @Bob'
      );
    });

    it('rewrites repeated mentions of the same user', () => {
      const cache = new Map([[g1, 'Alice']]);
      expect(rewriteMentions(`@<${g1}> @<${g1}>`, cache)).toBe('@Alice @Alice');
    });

    it('leaves comment bodies without mentions unchanged', () => {
      const cache = new Map([[g1, 'Alice']]);
      expect(rewriteMentions('plain text', cache)).toBe('plain text');
    });
  });

  describe('fetchCommentThreads @mention resolution', () => {
    beforeEach(() => {
      mockFetch.mockReset();
      _clearMentionCacheForTests();
    });

    const alice = '11111111-1111-1111-1111-111111111111';
    const bob = '22222222-2222-2222-2222-222222222222';

    it('replaces @<guid> with @displayName using the Identities API', async () => {
      // 1) threads response
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 1,
              status: 'active',
              threadContext: {
                filePath: '/src/foo.ts',
                rightFileStart: { line: 10 },
                rightFileEnd: { line: 10 },
              },
              comments: [
                {
                  id: 11,
                  commentType: 'text',
                  content: `hi @<${alice}> please look`,
                  author: { displayName: 'Me' },
                  publishedDate: '2026-04-24T00:00:00Z',
                },
                {
                  id: 12,
                  commentType: 'text',
                  content: `cc @<${bob}> too`,
                  author: { displayName: 'Me' },
                  publishedDate: '2026-04-24T00:01:00Z',
                },
              ],
            },
          ],
        })
      );
      // 2) identities batch response
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            { id: alice, providerDisplayName: 'Alice Smith' },
            { id: bob, providerDisplayName: 'Bob Jones' },
          ],
        })
      );

      const result = await azureDevOpsProvider.fetchCommentThreads!(
        { pat: 't' },
        testProject,
        1
      );

      const thread = result.threads[0];
      expect(thread.comments[0].body).toBe('hi @Alice Smith please look');
      expect(thread.comments[1].body).toBe('cc @Bob Jones too');

      // Second call should be the identities API, batching both guids
      const identityCall = mockFetch.mock.calls[1][0] as string;
      expect(identityCall).toContain('/identities?identityIds=');
      expect(identityCall).toContain(alice);
      expect(identityCall).toContain(bob);
    });

    it('leaves original @<guid> intact when the Identities API fails', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 1,
              status: 'active',
              threadContext: {
                filePath: '/src/foo.ts',
                rightFileStart: { line: 1 },
                rightFileEnd: { line: 1 },
              },
              comments: [
                {
                  id: 1,
                  commentType: 'text',
                  content: `@<${alice}> please`,
                  author: { displayName: 'Me' },
                  publishedDate: '2026-04-24T00:00:00Z',
                },
              ],
            },
          ],
        })
      );
      // identities call errors
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));

      const result = await azureDevOpsProvider.fetchCommentThreads!(
        { pat: 't' },
        testProject,
        1
      );

      // The original token survives the failure — comment still renders,
      // user sees the unresolved GUID, no hard crash.
      expect(result.threads[0].comments[0].body).toBe(`@<${alice}> please`);
    });

    it('skips the Identities API entirely when no mentions are present', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            {
              id: 1,
              status: 'active',
              threadContext: {
                filePath: '/src/foo.ts',
                rightFileStart: { line: 1 },
                rightFileEnd: { line: 1 },
              },
              comments: [
                {
                  id: 1,
                  commentType: 'text',
                  content: 'no mentions here',
                  author: { displayName: 'Me' },
                  publishedDate: '2026-04-24T00:00:00Z',
                },
              ],
            },
          ],
        })
      );

      await azureDevOpsProvider.fetchCommentThreads!(
        { pat: 't' },
        testProject,
        1
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('reuses cached display names on the next fetch (no second Identities call)', async () => {
      const threadsResponse = {
        value: [
          {
            id: 1,
            status: 'active',
            threadContext: {
              filePath: '/src/foo.ts',
              rightFileStart: { line: 1 },
              rightFileEnd: { line: 1 },
            },
            comments: [
              {
                id: 1,
                commentType: 'text',
                content: `@<${alice}> hi`,
                author: { displayName: 'Me' },
                publishedDate: '2026-04-24T00:00:00Z',
              },
            ],
          },
        ],
      };

      // First fetch: threads + identities
      mockFetch.mockResolvedValueOnce(jsonResponse(threadsResponse));
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [{ id: alice, providerDisplayName: 'Alice' }],
        })
      );

      await azureDevOpsProvider.fetchCommentThreads!(
        { pat: 't' },
        testProject,
        1
      );
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Second fetch: only threads — alice is cached. The transport is
      // reset first so the threads really are re-read; without that
      // the request cache would answer both calls and the mention
      // cache would never be exercised.
      resetAdoTransport();
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(jsonResponse(threadsResponse));
      const result = await azureDevOpsProvider.fetchCommentThreads!(
        { pat: 't' },
        testProject,
        1
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.threads[0].comments[0].body).toBe('@Alice hi');
    });

    it("reads a pull request's threads once for both the count and the viewer", async () => {
      // The sidebar wants a comment count and the review workspace
      // wants the threads; they are the same endpoint, and asking it
      // twice per poll per row is what got Kirby throttled.
      mockFetch.mockResolvedValue(
        jsonResponse({
          value: [
            {
              id: 1,
              status: 'active',
              comments: [{ id: 1, commentType: 'text', content: 'hi' }],
            },
          ],
        })
      );

      const count = await fetchActiveCommentCount(testAdoConfig, 99);
      const threads = await azureDevOpsProvider.fetchCommentThreads!(
        { pat: 'test-pat' },
        testProject,
        99
      );

      expect(count).toBe(1);
      expect(threads.generalComments).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

// ── Thread anchoring ────────────────────────────────────────────────
//
// `fetchCommentThreads` is the only route to the thread transform, so
// these drive the provider with a single canned /threads response and
// assert where each thread lands. The payloads are the shapes ADO
// actually emits: live line refs, refs that have gone null with only
// `trackingCriteria` left, and a file-anchored thread carrying no line
// refs at all.

describe('fetchCommentThreads thread anchoring', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _clearMentionCacheForTests();
  });

  const comment = {
    id: 7,
    commentType: 'text',
    content: 'take a look',
    author: { displayName: 'Alice' },
    publishedDate: '2026-04-24T00:00:00Z',
  };

  async function transform(threads: unknown[]): Promise<PullRequestComments> {
    mockFetch.mockResolvedValueOnce(jsonResponse({ value: threads }));
    return azureDevOpsProvider.fetchCommentThreads!(
      { pat: 't' },
      testProject,
      1
    );
  }

  it('anchors a right-side thread to its current line refs', async () => {
    const { threads } = await transform([
      {
        id: 1,
        status: 'active',
        threadContext: {
          filePath: '/src/foo.ts',
          rightFileStart: { line: 10 },
          rightFileEnd: { line: 12 },
        },
        comments: [comment],
      },
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      id: '1',
      file: 'src/foo.ts',
      lineStart: 10,
      lineEnd: 12,
      side: 'RIGHT',
      isOutdated: false,
      isResolved: false,
      canResolve: true,
    });
  });

  it('anchors to the left side when only the left refs are present', async () => {
    const { threads } = await transform([
      {
        id: 2,
        status: 'active',
        threadContext: {
          filePath: '/src/foo.ts',
          leftFileStart: { line: 4 },
          leftFileEnd: { line: 5 },
        },
        comments: [comment],
      },
    ]);
    expect(threads[0]).toMatchObject({
      lineStart: 4,
      lineEnd: 5,
      side: 'LEFT',
      isOutdated: false,
    });
  });

  it('prefers the right side when both sides carry refs', async () => {
    const { threads } = await transform([
      {
        id: 3,
        status: 'active',
        threadContext: {
          filePath: '/src/foo.ts',
          leftFileStart: { line: 4 },
          leftFileEnd: { line: 4 },
          rightFileStart: { line: 9 },
          rightFileEnd: { line: 9 },
        },
        comments: [comment],
      },
    ]);
    expect(threads[0]).toMatchObject({
      lineStart: 9,
      lineEnd: 9,
      side: 'RIGHT',
      isOutdated: false,
    });
  });

  it('falls back to trackingCriteria and marks the thread outdated', async () => {
    const { threads } = await transform([
      {
        id: 4,
        status: 'active',
        threadContext: { filePath: '/src/foo.ts' },
        pullRequestThreadContext: {
          trackingCriteria: {
            origRightFileStart: { line: 30 },
            origRightFileEnd: { line: 31 },
          },
        },
        comments: [comment],
      },
    ]);
    expect(threads[0]).toMatchObject({
      lineStart: 30,
      lineEnd: 31,
      side: 'RIGHT',
      isOutdated: true,
    });
  });

  it('falls back to the original left refs on a deleted line', async () => {
    const { threads } = await transform([
      {
        id: 5,
        status: 'active',
        threadContext: { filePath: '/src/foo.ts' },
        pullRequestThreadContext: {
          trackingCriteria: {
            origLeftFileStart: { line: 8 },
            origLeftFileEnd: { line: 8 },
          },
        },
        comments: [comment],
      },
    ]);
    expect(threads[0]).toMatchObject({
      lineStart: 8,
      lineEnd: 8,
      side: 'LEFT',
      isOutdated: true,
    });
  });

  it('keeps a live line ref in preference to the tracked original', async () => {
    const { threads } = await transform([
      {
        id: 6,
        status: 'active',
        threadContext: {
          filePath: '/src/foo.ts',
          rightFileStart: { line: 42 },
          rightFileEnd: { line: 42 },
        },
        pullRequestThreadContext: {
          trackingCriteria: {
            origRightFileStart: { line: 30 },
            origRightFileEnd: { line: 30 },
          },
        },
        comments: [comment],
      },
    ]);
    expect(threads[0]).toMatchObject({
      lineStart: 42,
      lineEnd: 42,
      isOutdated: false,
    });
  });

  it('pins a file-anchored thread with no line refs to line 1, outdated', async () => {
    const { threads } = await transform([
      {
        id: 7,
        status: 'active',
        threadContext: { filePath: '/src/foo.ts' },
        comments: [comment],
      },
    ]);
    expect(threads[0]).toMatchObject({
      file: 'src/foo.ts',
      lineStart: 1,
      lineEnd: 1,
      side: 'RIGHT',
      isOutdated: true,
    });
  });

  it('routes a thread with no file to the general comments', async () => {
    const { threads, generalComments } = await transform([
      { id: 8, status: 'active', comments: [comment] },
    ]);
    expect(threads).toHaveLength(0);
    expect(generalComments).toHaveLength(1);
    expect(generalComments[0]).toMatchObject({
      file: null,
      lineStart: null,
      lineEnd: null,
      side: 'RIGHT',
      isOutdated: false,
    });
  });

  it('drops a thread whose comments are all system comments', async () => {
    const { threads, generalComments } = await transform([
      {
        id: 9,
        status: 'active',
        threadContext: {
          filePath: '/src/foo.ts',
          rightFileStart: { line: 1 },
          rightFileEnd: { line: 1 },
        },
        comments: [{ id: 1, commentType: 'system', content: 'voted 10' }],
      },
    ]);
    expect(threads).toHaveLength(0);
    expect(generalComments).toHaveLength(0);
  });

  it('keeps the human comments of a mixed thread and maps their fields', async () => {
    const { threads } = await transform([
      {
        id: 10,
        status: 'active',
        threadContext: {
          filePath: '/src/foo.ts',
          rightFileStart: { line: 1 },
          rightFileEnd: { line: 1 },
        },
        comments: [
          { id: 1, commentType: 'system', content: 'updated the PR' },
          {
            id: 2,
            commentType: 'text',
            content: 'please rename',
            author: { uniqueName: 'bob@example.com' },
            publishedDate: '2026-04-24T09:00:00Z',
          },
          { id: 3, commentType: 'text', content: 'no author here' },
        ],
      },
    ]);
    expect(threads[0].comments).toEqual([
      {
        id: '2',
        author: 'bob@example.com',
        body: 'please rename',
        createdAt: '2026-04-24T09:00:00Z',
      },
      { id: '3', author: 'unknown', body: 'no author here', createdAt: '' },
    ]);
  });

  it.each([
    ['fixed', true],
    ['wontFix', true],
    ['closed', true],
    ['byDesign', true],
    ['active', false],
    ['pending', false],
    [undefined, false],
  ])('maps thread status %s to isResolved %s', async (status, expected) => {
    const { threads } = await transform([
      {
        id: 11,
        status,
        threadContext: {
          filePath: '/src/foo.ts',
          rightFileStart: { line: 1 },
          rightFileEnd: { line: 1 },
        },
        comments: [comment],
      },
    ]);
    expect(threads[0].isResolved).toBe(expected);
  });
});
