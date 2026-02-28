import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseGitHubRemoteUrl,
  mapReviewState,
  latestReviewPerUser,
  deriveCheckRunStatus,
  fetchOpenPrs,
  fetchReviews,
  fetchCheckRuns,
  githubProvider,
} from './provider.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  } as Response;
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

// ── API helpers ────────────────────────────────────────────────────

describe('fetchOpenPrs', () => {
  beforeEach(() => mockFetch.mockReset());

  it('calls correct URL and returns parsed PRs', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([
        {
          number: 42,
          title: 'Add feature X',
          head: { ref: 'feat/x' },
          base: { ref: 'main' },
          html_url: 'https://github.com/octocat/hello-world/pull/42',
          user: { login: 'octocat' },
          draft: false,
        },
      ])
    );

    const result = await fetchOpenPrs('ghp_test', testProject);

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('/repos/octocat/hello-world/pulls');
    expect(calledUrl).toContain('state=open');
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
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 401));
    await expect(fetchOpenPrs('bad-token', testProject)).rejects.toThrow(
      'GitHub API error 401'
    );
  });

  it('sends Bearer auth header', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    await fetchOpenPrs('ghp_test', testProject);

    const headers = mockFetch.mock.calls[0]![1]?.headers as Record<
      string,
      string
    >;
    expect(headers.Authorization).toBe('Bearer ghp_test');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });
});

describe('fetchReviews', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns deduplicated reviewers', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([
        { user: { login: 'alice' }, state: 'COMMENTED' },
        { user: { login: 'alice' }, state: 'APPROVED' },
      ])
    );

    const result = await fetchReviews('ghp_test', testProject, 42);
    expect(result).toHaveLength(1);
    expect(result[0]!.decision).toBe('approved');

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('/pulls/42/reviews');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 403));
    await expect(fetchReviews('ghp_test', testProject, 42)).rejects.toThrow(
      'GitHub API error 403'
    );
  });
});

describe('fetchCheckRuns', () => {
  beforeEach(() => mockFetch.mockReset());

  it('calls correct URL and returns derived status', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        check_runs: [
          { status: 'completed', conclusion: 'success' },
          { status: 'in_progress', conclusion: null },
        ],
      })
    );

    const result = await fetchCheckRuns('ghp_test', testProject, 'feat/x');
    expect(result).toBe('pending');

    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('/commits/feat/x/check-runs');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 500));
    await expect(
      fetchCheckRuns('ghp_test', testProject, 'main')
    ).rejects.toThrow('GitHub API error 500');
  });
});

// ── Provider interface ─────────────────────────────────────────────

describe('githubProvider', () => {
  it('has correct id and displayName', () => {
    expect(githubProvider.id).toBe('github');
    expect(githubProvider.displayName).toBe('GitHub');
  });

  it('isConfigured returns true when token, owner, and repo set', () => {
    expect(
      githubProvider.isConfigured(
        { token: 'ghp_test' },
        { owner: 'o', repo: 'r' }
      )
    ).toBe(true);
  });

  it('isConfigured returns false when token missing', () => {
    expect(githubProvider.isConfigured({}, { owner: 'o', repo: 'r' })).toBe(
      false
    );
  });

  it('isConfigured returns false when owner missing', () => {
    expect(
      githubProvider.isConfigured({ token: 'ghp_test' }, { repo: 'r' })
    ).toBe(false);
  });

  it('isConfigured returns true even without username', () => {
    expect(
      githubProvider.isConfigured(
        { token: 'ghp_test' },
        { owner: 'o', repo: 'r' }
      )
    ).toBe(true);
  });

  it('matchesUser matches by username from vendorProject', () => {
    expect(
      githubProvider.matchesUser('Octocat', {
        vendorAuth: {},
        vendorProject: { username: 'octocat' },
      })
    ).toBe(true);
  });

  it('matchesUser falls back to email when no username', () => {
    expect(
      githubProvider.matchesUser('user@example.com', {
        email: 'user@example.com',
        vendorAuth: {},
        vendorProject: {},
      })
    ).toBe(true);
  });

  it('matchesUser returns false when no username and no email', () => {
    expect(
      githubProvider.matchesUser('octocat', {
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
    beforeEach(() => mockFetch.mockReset());

    it('returns a map of branch to PR info with reviews and build status', async () => {
      // First call: list PRs
      mockFetch.mockResolvedValueOnce(
        jsonResponse([
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
        ])
      );
      // PR 10: reviews then check-runs
      mockFetch.mockResolvedValueOnce(
        jsonResponse([{ user: { login: 'bob' }, state: 'APPROVED' }])
      );
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          check_runs: [{ status: 'completed', conclusion: 'success' }],
        })
      );
      // PR 11: reviews then check-runs
      mockFetch.mockResolvedValueOnce(jsonResponse([]));
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          check_runs: [{ status: 'completed', conclusion: 'failure' }],
        })
      );

      const result = await githubProvider.fetchPullRequests(
        { token: 'ghp_test' },
        testProject
      );

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
      });
    });
  });
});
