import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseReviewer,
  parsePullRequest,
  countActiveThreads,
  deriveBuildStatus,
  fetchActivePullRequests,
  fetchActiveCommentCount,
  fetchPrBuildStatus,
  parseAdoRemoteUrl,
  azureDevOpsProvider,
  fetchAuthenticatedUserEmail,
  fetchMyTeamIds,
  enrichReviewersWithTeamMembership,
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

  it('maps vote -5 to changes-requested', () => {
    expect(parseReviewer({ vote: -5 }).decision).toBe('changes-requested');
  });

  it('maps vote -10 to changes-requested', () => {
    expect(parseReviewer({ vote: -10 }).decision).toBe('changes-requested');
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
});

describe('fetchActivePullRequests', () => {
  beforeEach(() => mockFetch.mockReset());

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

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 401));
    await expect(
      fetchActivePullRequests(testAdoConfig, testProject)
    ).rejects.toThrow('ADO API error 401');
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
  beforeEach(() => mockFetch.mockReset());

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
  beforeEach(() => mockFetch.mockReset());

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

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 403));
    await expect(fetchPrBuildStatus(testAdoConfig, 42)).rejects.toThrow(
      'ADO API error 403'
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
  beforeEach(() => mockFetch.mockReset());

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

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 401));
    await expect(fetchAuthenticatedUserEmail(testAdoConfig)).rejects.toThrow(
      'ADO API error 401'
    );
  });
});

describe('fetchMyTeamIds', () => {
  beforeEach(() => mockFetch.mockReset());

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
    beforeEach(() => mockFetch.mockReset());

    it('returns a map of branch to PR info with comment counts', async () => {
      // connectiondata call (fetchAuthenticatedUserEmail)
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          authenticatedUser: {
            properties: { Account: { $value: 'me@example.com' } },
          },
        })
      );
      // teams call (fetchMyTeamIds) — no teams
      mockFetch.mockResolvedValueOnce(jsonResponse({ value: [] }));
      // list PRs
      mockFetch.mockResolvedValueOnce(
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
      // PR 42: threads then statuses
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          value: [
            { status: 'active', comments: [{ commentType: 'text' }] },
            { status: 'active', comments: [{ commentType: 'text' }] },
          ],
        })
      );
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ value: [{ state: 'succeeded' }] })
      );
      // PR 43: threads then statuses
      mockFetch.mockResolvedValueOnce(jsonResponse({ value: [] }));
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ value: [{ state: 'failed' }] })
      );

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
});
