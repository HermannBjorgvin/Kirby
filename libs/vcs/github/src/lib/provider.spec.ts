import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseGitHubRemoteUrl,
  mapReviewState,
  latestReviewPerUser,
  deriveCheckRunStatus,
  fetchOpenPrs,
  fetchReviews,
  fetchCheckRuns,
  fetchUnresolvedThreadCount,
  ghApi,
  ghGraphQL,
  githubProvider,
} from './provider.js';

// Mock child_process.execFile
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

function ghSuccess(data: unknown) {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      cb: (err: null, result: { stdout: string }) => void
    ) => {
      cb(null, { stdout: JSON.stringify(data) });
    }
  );
}

function ghError(message: string) {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], cb: (err: { stderr: string }) => void) => {
      cb({ stderr: message });
    }
  );
}

const testProject = { owner: 'octocat', repo: 'hello-world' };

// ── URL parsing ────────────────────────────────────────────────────

describe('parseGitHubRemoteUrl', () => {
  it('parses HTTPS URL', () => {
    expect(
      parseGitHubRemoteUrl('https://github.com/octocat/hello-world')
    ).toEqual({ owner: 'octocat', repo: 'hello-world' });
  });

  it('parses HTTPS URL with .git suffix', () => {
    expect(
      parseGitHubRemoteUrl('https://github.com/octocat/hello-world.git')
    ).toEqual({ owner: 'octocat', repo: 'hello-world' });
  });

  it('parses SSH URL', () => {
    expect(parseGitHubRemoteUrl('git@github.com:octocat/hello-world')).toEqual({
      owner: 'octocat',
      repo: 'hello-world',
    });
  });

  it('parses SSH URL with .git suffix', () => {
    expect(
      parseGitHubRemoteUrl('git@github.com:octocat/hello-world.git')
    ).toEqual({ owner: 'octocat', repo: 'hello-world' });
  });

  it('returns null for non-GitHub URLs', () => {
    expect(
      parseGitHubRemoteUrl('https://dev.azure.com/org/proj/_git/repo')
    ).toBeNull();
    expect(parseGitHubRemoteUrl('git@gitlab.com:user/repo.git')).toBeNull();
    expect(parseGitHubRemoteUrl('not a url')).toBeNull();
  });
});

// ── Review state mapping ───────────────────────────────────────────

describe('mapReviewState', () => {
  it('maps APPROVED to approved', () => {
    expect(mapReviewState('APPROVED')).toBe('approved');
  });

  it('maps CHANGES_REQUESTED to changes-requested', () => {
    expect(mapReviewState('CHANGES_REQUESTED')).toBe('changes-requested');
  });

  it('maps DISMISSED to declined', () => {
    expect(mapReviewState('DISMISSED')).toBe('declined');
  });

  it('maps COMMENTED to no-response', () => {
    expect(mapReviewState('COMMENTED')).toBe('no-response');
  });

  it('maps PENDING to no-response', () => {
    expect(mapReviewState('PENDING')).toBe('no-response');
  });

  it('maps unknown state to no-response', () => {
    expect(mapReviewState('SOMETHING_ELSE')).toBe('no-response');
  });
});

// ── Latest review deduplication ────────────────────────────────────

describe('latestReviewPerUser', () => {
  it('keeps latest review per user', () => {
    const reviews = [
      { user: { login: 'alice' }, state: 'COMMENTED' },
      { user: { login: 'alice' }, state: 'APPROVED' },
      { user: { login: 'bob' }, state: 'CHANGES_REQUESTED' },
    ];
    const result = latestReviewPerUser(reviews);
    expect(result).toHaveLength(2);
    const alice = result.find((r) => r.identifier === 'alice');
    expect(alice?.decision).toBe('approved');
    const bob = result.find((r) => r.identifier === 'bob');
    expect(bob?.decision).toBe('changes-requested');
  });

  it('returns empty array for no reviews', () => {
    expect(latestReviewPerUser([])).toEqual([]);
  });

  it('sets displayName and identifier to login', () => {
    const result = latestReviewPerUser([
      { user: { login: 'charlie' }, state: 'APPROVED' },
    ]);
    expect(result[0]).toEqual({
      displayName: 'charlie',
      identifier: 'charlie',
      decision: 'approved',
    });
  });
});

// ── Check run aggregation ──────────────────────────────────────────

describe('deriveCheckRunStatus', () => {
  it('returns none for empty array', () => {
    expect(deriveCheckRunStatus([])).toBe('none');
  });

  it('returns succeeded when all pass', () => {
    expect(
      deriveCheckRunStatus([
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'success' },
      ])
    ).toBe('succeeded');
  });

  it('returns failed when any fails', () => {
    expect(
      deriveCheckRunStatus([
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'failure' },
      ])
    ).toBe('failed');
  });

  it('returns failed for timed_out conclusion', () => {
    expect(
      deriveCheckRunStatus([{ status: 'completed', conclusion: 'timed_out' }])
    ).toBe('failed');
  });

  it('returns failed for cancelled conclusion', () => {
    expect(
      deriveCheckRunStatus([{ status: 'completed', conclusion: 'cancelled' }])
    ).toBe('failed');
  });

  it('returns failed for action_required conclusion', () => {
    expect(
      deriveCheckRunStatus([
        { status: 'completed', conclusion: 'action_required' },
      ])
    ).toBe('failed');
  });

  it('returns pending when any in_progress', () => {
    expect(
      deriveCheckRunStatus([
        { status: 'completed', conclusion: 'success' },
        { status: 'in_progress', conclusion: null },
      ])
    ).toBe('pending');
  });

  it('returns pending for queued status', () => {
    expect(deriveCheckRunStatus([{ status: 'queued', conclusion: null }])).toBe(
      'pending'
    );
  });

  it('failed takes priority over pending', () => {
    expect(
      deriveCheckRunStatus([
        { status: 'completed', conclusion: 'failure' },
        { status: 'in_progress', conclusion: null },
      ])
    ).toBe('failed');
  });
});

// ── ghApi transport ────────────────────────────────────────────────

describe('ghApi', () => {
  beforeEach(() => mockExecFile.mockReset());

  it('calls gh with correct args and parses JSON', async () => {
    ghSuccess({ hello: 'world' });
    const result = await ghApi('repos/o/r/pulls');
    expect(mockExecFile).toHaveBeenCalledOnce();
    expect(mockExecFile.mock.calls[0]![0]).toBe('gh');
    expect(mockExecFile.mock.calls[0]![1]).toEqual(['api', 'repos/o/r/pulls']);
    expect(result).toEqual({ hello: 'world' });
  });

  it('throws with stderr on failure', async () => {
    ghError('Not Found (HTTP 404)');
    await expect(ghApi('repos/o/r/pulls')).rejects.toThrow(
      'gh api error: Not Found (HTTP 404)'
    );
  });
});

describe('ghGraphQL', () => {
  beforeEach(() => mockExecFile.mockReset());

  it('calls gh with graphql args and parses JSON', async () => {
    ghSuccess({ data: { repository: { name: 'test' } } });
    const result = await ghGraphQL(
      'query($owner: String!) { repository(owner: $owner) { name } }',
      { owner: 'octocat' }
    );
    expect(mockExecFile).toHaveBeenCalledOnce();
    const args = mockExecFile.mock.calls[0]![1] as string[];
    expect(args[0]).toBe('api');
    expect(args[1]).toBe('graphql');
    expect(args[2]).toBe('-f');
    expect(args[3]).toContain('query($owner');
    expect(args[4]).toBe('-F');
    expect(args[5]).toBe('owner=octocat');
    expect(result).toEqual({ data: { repository: { name: 'test' } } });
  });

  it('throws with stderr on failure', async () => {
    ghError('GraphQL error');
    await expect(ghGraphQL('{ viewer { login } }', {})).rejects.toThrow(
      'gh graphql error: GraphQL error'
    );
  });
});

describe('fetchUnresolvedThreadCount', () => {
  beforeEach(() => mockExecFile.mockReset());

  it('returns unresolved thread count (total minus resolved)', async () => {
    ghSuccess({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: { totalCount: 5 },
            resolvedThreads: { totalCount: 2 },
          },
        },
      },
    });
    const count = await fetchUnresolvedThreadCount(testProject, 42);
    expect(count).toBe(3);
    const args = mockExecFile.mock.calls[0]![1] as string[];
    expect(args).toContain('-F');
    expect(args).toContain('number=42');
  });

  it('returns 0 when all threads resolved', async () => {
    ghSuccess({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: { totalCount: 4 },
            resolvedThreads: { totalCount: 4 },
          },
        },
      },
    });
    expect(await fetchUnresolvedThreadCount(testProject, 1)).toBe(0);
  });
});

// ── API helpers ────────────────────────────────────────────────────

describe('fetchOpenPrs', () => {
  beforeEach(() => mockExecFile.mockReset());

  it('returns parsed PRs', async () => {
    ghSuccess([
      {
        number: 42,
        title: 'Add feature X',
        head: { ref: 'feat/x' },
        base: { ref: 'main' },
        html_url: 'https://github.com/octocat/hello-world/pull/42',
        user: { login: 'octocat' },
        draft: false,
      },
    ]);

    const result = await fetchOpenPrs(testProject);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 42,
      title: 'Add feature X',
      sourceBranch: 'feat/x',
      targetBranch: 'main',
      url: 'https://github.com/octocat/hello-world/pull/42',
      createdByIdentifier: 'octocat',
      createdByDisplayName: 'octocat',
      isDraft: false,
    });

    const endpoint = mockExecFile.mock.calls[0]![1]![1] as string;
    expect(endpoint).toContain('repos/octocat/hello-world/pulls');
    expect(endpoint).toContain('state=open');
  });

  it('throws on gh error', async () => {
    ghError('HTTP 401');
    await expect(fetchOpenPrs(testProject)).rejects.toThrow('gh api error');
  });
});

describe('fetchReviews', () => {
  beforeEach(() => mockExecFile.mockReset());

  it('returns deduplicated reviewers', async () => {
    ghSuccess([
      { user: { login: 'alice' }, state: 'COMMENTED' },
      { user: { login: 'alice' }, state: 'APPROVED' },
    ]);

    const result = await fetchReviews(testProject, 42);
    expect(result).toHaveLength(1);
    expect(result[0]!.decision).toBe('approved');

    const endpoint = mockExecFile.mock.calls[0]![1]![1] as string;
    expect(endpoint).toContain('/pulls/42/reviews');
  });

  it('throws on gh error', async () => {
    ghError('HTTP 403');
    await expect(fetchReviews(testProject, 42)).rejects.toThrow('gh api error');
  });
});

describe('fetchCheckRuns', () => {
  beforeEach(() => mockExecFile.mockReset());

  it('returns derived status', async () => {
    ghSuccess({
      check_runs: [
        { status: 'completed', conclusion: 'success' },
        { status: 'in_progress', conclusion: null },
      ],
    });

    const result = await fetchCheckRuns(testProject, 'feat/x');
    expect(result).toBe('pending');

    const endpoint = mockExecFile.mock.calls[0]![1]![1] as string;
    expect(endpoint).toContain('/commits/feat/x/check-runs');
  });

  it('throws on gh error', async () => {
    ghError('HTTP 500');
    await expect(fetchCheckRuns(testProject, 'main')).rejects.toThrow(
      'gh api error'
    );
  });
});

// ── Provider interface ─────────────────────────────────────────────

describe('githubProvider', () => {
  it('has correct id and displayName', () => {
    expect(githubProvider.id).toBe('github');
    expect(githubProvider.displayName).toBe('GitHub');
  });

  it('has no authFields', () => {
    expect(githubProvider.authFields).toEqual([]);
  });

  it('isConfigured returns true when owner and repo set', () => {
    expect(githubProvider.isConfigured({}, { owner: 'o', repo: 'r' })).toBe(
      true
    );
  });

  it('isConfigured returns false when owner missing', () => {
    expect(githubProvider.isConfigured({}, { repo: 'r' })).toBe(false);
  });

  it('isConfigured returns false when repo missing', () => {
    expect(githubProvider.isConfigured({}, { owner: 'o' })).toBe(false);
  });

  it('matchesUser matches by username from vendorProject', () => {
    expect(
      githubProvider.matchesUser('Octocat', {
        vendorAuth: {},
        vendorProject: { username: 'octocat' },
      })
    ).toBe(true);
  });

  it('matchesUser returns false when no username configured', () => {
    expect(
      githubProvider.matchesUser('octocat', {
        email: 'user@example.com',
        vendorAuth: {},
        vendorProject: {},
      })
    ).toBe(false);
  });

  it('parseRemoteUrl delegates to parseGitHubRemoteUrl', () => {
    expect(githubProvider.parseRemoteUrl('https://github.com/o/r')).toEqual({
      owner: 'o',
      repo: 'r',
    });
    expect(
      githubProvider.parseRemoteUrl('https://dev.azure.com/o/p/_git/r')
    ).toBeNull();
  });

  it('getPullRequestUrl constructs correct URL', () => {
    expect(
      githubProvider.getPullRequestUrl(
        { owner: 'octocat', repo: 'hello-world' },
        42
      )
    ).toBe('https://github.com/octocat/hello-world/pull/42');
  });

  describe('fetchPullRequests', () => {
    beforeEach(() => mockExecFile.mockReset());

    it('returns a map of branch to PR info with reviews and build status', async () => {
      // list PRs
      ghSuccess([
        {
          number: 10,
          title: 'Feature A',
          head: { ref: 'feat-a' },
          base: { ref: 'main' },
          html_url: 'https://github.com/octocat/hello-world/pull/10',
          user: { login: 'octocat' },
          draft: false,
        },
        {
          number: 11,
          title: 'Feature B',
          head: { ref: 'feat-b' },
          base: { ref: 'main' },
          html_url: 'https://github.com/octocat/hello-world/pull/11',
          user: { login: 'alice' },
          draft: true,
        },
      ]);
      // PR 10: reviews, check-runs, unresolved threads
      ghSuccess([{ user: { login: 'bob' }, state: 'APPROVED' }]);
      ghSuccess({
        check_runs: [{ status: 'completed', conclusion: 'success' }],
      });
      ghSuccess({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: { totalCount: 5 },
              resolvedThreads: { totalCount: 3 },
            },
          },
        },
      });
      // PR 11: reviews, check-runs, unresolved threads
      ghSuccess([]);
      ghSuccess({
        check_runs: [{ status: 'completed', conclusion: 'failure' }],
      });
      ghSuccess({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: { totalCount: 0 },
              resolvedThreads: { totalCount: 0 },
            },
          },
        },
      });

      const result = await githubProvider.fetchPullRequests({}, testProject);

      expect(result['feat-a']).toEqual({
        id: 10,
        title: 'Feature A',
        sourceBranch: 'feat-a',
        targetBranch: 'main',
        url: 'https://github.com/octocat/hello-world/pull/10',
        createdByIdentifier: 'octocat',
        createdByDisplayName: 'octocat',
        isDraft: false,
        reviewers: [
          {
            displayName: 'bob',
            identifier: 'bob',
            decision: 'approved',
          },
        ],
        buildStatus: 'succeeded',
        activeCommentCount: 2,
      });
      expect(result['feat-b']).toEqual({
        id: 11,
        title: 'Feature B',
        sourceBranch: 'feat-b',
        targetBranch: 'main',
        url: 'https://github.com/octocat/hello-world/pull/11',
        createdByIdentifier: 'alice',
        createdByDisplayName: 'alice',
        isDraft: true,
        reviewers: [],
        buildStatus: 'failed',
        activeCommentCount: 0,
      });
    });
  });
});
