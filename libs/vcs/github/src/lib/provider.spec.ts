import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import {
  parseGitHubRemoteUrl,
  mapReviewState,
  latestReviewPerUser,
  mapRollupState,
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
      { author: { login: 'alice' }, state: 'COMMENTED' },
      { author: { login: 'alice' }, state: 'APPROVED' },
      { author: { login: 'bob' }, state: 'CHANGES_REQUESTED' },
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

  it('skips reviews with null author', () => {
    const reviews = [
      { author: null, state: 'APPROVED' },
      { author: { login: 'alice' }, state: 'CHANGES_REQUESTED' },
    ];
    const result = latestReviewPerUser(reviews);
    expect(result).toHaveLength(1);
    expect(result[0]?.identifier).toBe('alice');
  });

  it('sets displayName and identifier to login', () => {
    const result = latestReviewPerUser([
      { author: { login: 'charlie' }, state: 'APPROVED' },
    ]);
    expect(result[0]).toEqual({
      displayName: 'charlie',
      identifier: 'charlie',
      decision: 'approved',
    });
  });
});

// ── Rollup state mapping ──────────────────────────────────────────

describe('mapRollupState', () => {
  it('maps SUCCESS to succeeded', () => {
    expect(mapRollupState('SUCCESS')).toBe('succeeded');
  });

  it('maps FAILURE to failed', () => {
    expect(mapRollupState('FAILURE')).toBe('failed');
  });

  it('maps ERROR to failed', () => {
    expect(mapRollupState('ERROR')).toBe('failed');
  });

  it('maps PENDING to pending', () => {
    expect(mapRollupState('PENDING')).toBe('pending');
  });

  it('maps EXPECTED to pending', () => {
    expect(mapRollupState('EXPECTED')).toBe('pending');
  });

  it('maps null to none', () => {
    expect(mapRollupState(null)).toBe('none');
  });

  it('maps undefined to none', () => {
    expect(mapRollupState(undefined)).toBe('none');
  });

  it('maps unknown string to none', () => {
    expect(mapRollupState('SOMETHING_ELSE')).toBe('none');
  });
});

// ── ghGraphQL transport ─────────────────────────────────────────

describe('ghGraphQL', () => {
  beforeEach(() => mockExecFile.mockReset());

  it('uses -f for string variables and -F for numeric variables', async () => {
    ghSuccess({ data: {} });
    await ghGraphQL('query { test }', { name: 'alice', count: 42 });
    const args = mockExecFile.mock.calls[0]![1] as string[];
    // query always uses -f
    expect(args[0]).toBe('api');
    expect(args[1]).toBe('graphql');
    expect(args[2]).toBe('-f');
    expect(args[3]).toContain('query=');
    // string var uses -f
    expect(args[4]).toBe('-f');
    expect(args[5]).toBe('name=alice');
    // numeric var uses -F
    expect(args[6]).toBe('-F');
    expect(args[7]).toBe('count=42');
  });

  it('parses JSON response', async () => {
    ghSuccess({ data: { viewer: { login: 'test' } } });
    const result = await ghGraphQL('{ viewer { login } }', {});
    expect(result).toEqual({ data: { viewer: { login: 'test' } } });
  });

  it('throws with stderr on failure', async () => {
    ghError('GraphQL error');
    await expect(ghGraphQL('{ viewer { login } }', {})).rejects.toThrow(
      'gh graphql error: GraphQL error'
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

    it('returns empty map when no username configured', async () => {
      const result = await githubProvider.fetchPullRequests(
        {},
        { owner: 'octocat', repo: 'hello-world' }
      );
      expect(result).toEqual({});
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('transforms GraphQL search response to BranchPrMap', async () => {
      ghSuccess({
        data: {
          search: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 10,
                title: 'Feature A',
                headRefName: 'feat-a',
                baseRefName: 'main',
                url: 'https://github.com/octocat/hello-world/pull/10',
                author: { login: 'octocat' },
                isDraft: false,
                reviews: {
                  nodes: [{ author: { login: 'bob' }, state: 'APPROVED' }],
                },
                reviewRequests: { nodes: [] },
                reviewThreads: {
                  nodes: [
                    { isResolved: false },
                    { isResolved: true },
                    { isResolved: false },
                  ],
                },
                commits: {
                  nodes: [
                    {
                      commit: {
                        statusCheckRollup: { state: 'SUCCESS' },
                      },
                    },
                  ],
                },
              },
              {
                number: 11,
                title: 'Feature B',
                headRefName: 'feat-b',
                baseRefName: 'main',
                url: 'https://github.com/octocat/hello-world/pull/11',
                author: { login: 'alice' },
                isDraft: true,
                reviews: { nodes: [] },
                reviewRequests: { nodes: [] },
                reviewThreads: { nodes: [] },
                commits: {
                  nodes: [
                    {
                      commit: {
                        statusCheckRollup: { state: 'FAILURE' },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });

      const result = await githubProvider.fetchPullRequests(
        {},
        { owner: 'octocat', repo: 'hello-world', username: 'octocat' }
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

      // Verify the search query contains involves:username
      const args = mockExecFile.mock.calls[0]![1] as string[];
      const searchQueryArg = args.find((a: string) =>
        a.startsWith('searchQuery=')
      );
      expect(searchQueryArg).toContain('involves:octocat');
      expect(searchQueryArg).toContain('repo:octocat/hello-world');
      expect(searchQueryArg).toContain('is:pr');
      expect(searchQueryArg).toContain('is:open');
    });

    it('handles null author, null review author, and null requestedReviewer', async () => {
      ghSuccess({
        data: {
          search: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 99,
                title: 'Ghost PR',
                headRefName: 'ghost-branch',
                baseRefName: 'main',
                url: 'https://github.com/o/r/pull/99',
                author: null,
                isDraft: false,
                reviews: {
                  nodes: [{ author: null, state: 'APPROVED' }],
                },
                reviewRequests: {
                  nodes: [{ requestedReviewer: null }],
                },
                reviewThreads: { nodes: [] },
                commits: {
                  nodes: [{ commit: { statusCheckRollup: null } }],
                },
              },
            ],
          },
        },
      });

      const result = await githubProvider.fetchPullRequests(
        {},
        { owner: 'o', repo: 'r', username: 'user' }
      );

      expect(result['ghost-branch']).toEqual({
        id: 99,
        title: 'Ghost PR',
        sourceBranch: 'ghost-branch',
        targetBranch: 'main',
        url: 'https://github.com/o/r/pull/99',
        createdByIdentifier: '',
        createdByDisplayName: '',
        isDraft: false,
        reviewers: [],
        buildStatus: 'none',
        activeCommentCount: 0,
      });
    });

    it('paginates when hasNextPage is true', async () => {
      // Page 1
      ghSuccess({
        data: {
          search: {
            pageInfo: { hasNextPage: true, endCursor: 'cursor-abc' },
            nodes: [
              {
                number: 1,
                title: 'PR 1',
                headRefName: 'branch-1',
                baseRefName: 'main',
                url: 'https://github.com/o/r/pull/1',
                author: { login: 'user' },
                isDraft: false,
                reviews: { nodes: [] },
                reviewRequests: { nodes: [] },
                reviewThreads: { nodes: [] },
                commits: {
                  nodes: [{ commit: { statusCheckRollup: null } }],
                },
              },
            ],
          },
        },
      });
      // Page 2
      ghSuccess({
        data: {
          search: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                number: 2,
                title: 'PR 2',
                headRefName: 'branch-2',
                baseRefName: 'main',
                url: 'https://github.com/o/r/pull/2',
                author: { login: 'user' },
                isDraft: false,
                reviews: { nodes: [] },
                reviewRequests: { nodes: [] },
                reviewThreads: { nodes: [] },
                commits: {
                  nodes: [
                    { commit: { statusCheckRollup: { state: 'PENDING' } } },
                  ],
                },
              },
            ],
          },
        },
      });

      const result = await githubProvider.fetchPullRequests(
        {},
        { owner: 'o', repo: 'r', username: 'user' }
      );

      expect(Object.keys(result)).toHaveLength(2);
      expect(result['branch-1']?.id).toBe(1);
      expect(result['branch-1']?.buildStatus).toBe('none');
      expect(result['branch-2']?.id).toBe(2);
      expect(result['branch-2']?.buildStatus).toBe('pending');

      // Second call should include cursor
      expect(mockExecFile).toHaveBeenCalledTimes(2);
      const secondArgs = mockExecFile.mock.calls[1]![1] as string[];
      const cursorArg = secondArgs.find((a: string) => a.startsWith('cursor='));
      expect(cursorArg).toBe('cursor=cursor-abc');
    });
  });

  // ── Comment sync ─────────────────────────────────────────────────

  function findQueryArg(callIndex = 0): string {
    const args = mockExecFile.mock.calls[callIndex]![1] as string[];
    const q = args.find((a: string) => a.startsWith('query='));
    return q ?? '';
  }

  describe('fetchCommentThreads', () => {
    beforeEach(() => mockExecFile.mockReset());

    it('returns one review thread + one general comment from a single page', async () => {
      ghSuccess({
        data: {
          repository: {
            pullRequest: {
              id: 'PR_NODE_ID',
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 'thread-1',
                    isResolved: false,
                    isOutdated: false,
                    path: 'src/foo.ts',
                    line: 12,
                    startLine: null,
                    originalLine: 12,
                    originalStartLine: null,
                    diffSide: 'RIGHT',
                    comments: {
                      nodes: [
                        {
                          id: 'c-1',
                          author: { login: 'alice' },
                          body: 'looks good',
                          createdAt: '2026-01-01T00:00:00Z',
                          isMinimized: false,
                        },
                      ],
                    },
                  },
                ],
              },
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 'general-1',
                    author: { login: 'bob' },
                    body: 'overall LGTM',
                    createdAt: '2026-01-01T00:00:00Z',
                  },
                ],
              },
            },
          },
        },
      });

      const result = await githubProvider.fetchCommentThreads!(
        {},
        { owner: 'o', repo: 'r' },
        42
      );

      expect(result.threads).toHaveLength(1);
      expect(result.threads[0]).toMatchObject({
        id: 'thread-1',
        file: 'src/foo.ts',
        lineStart: 12,
        lineEnd: 12,
        side: 'RIGHT',
        isOutdated: false,
        canResolve: true,
      });
      expect(result.threads[0]!.comments[0]!.body).toBe('looks good');

      expect(result.generalComments).toHaveLength(1);
      expect(result.generalComments[0]).toMatchObject({
        id: 'general-1',
        replyKind: 'github-issue-comment',
        replySubjectId: 'PR_NODE_ID',
        canResolve: false,
      });
    });

    it('falls back to originalLine when an outdated thread has line=null', async () => {
      ghSuccess({
        data: {
          repository: {
            pullRequest: {
              id: 'PR_NODE_ID',
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 'thread-outdated',
                    isResolved: false,
                    isOutdated: true,
                    path: 'src/foo.ts',
                    line: null,
                    startLine: null,
                    originalLine: 7,
                    originalStartLine: null,
                    diffSide: 'RIGHT',
                    comments: { nodes: [] },
                  },
                ],
              },
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [],
              },
            },
          },
        },
      });

      const result = await githubProvider.fetchCommentThreads!(
        {},
        { owner: 'o', repo: 'r' },
        42
      );

      expect(result.threads[0]).toMatchObject({
        id: 'thread-outdated',
        lineStart: 7,
        lineEnd: 7,
        isOutdated: true,
      });
    });

    it('strips ANSI escape sequences from comment bodies', async () => {
      ghSuccess({
        data: {
          repository: {
            pullRequest: {
              id: 'PR_NODE_ID',
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 't',
                    isResolved: false,
                    isOutdated: false,
                    path: 'a.ts',
                    line: 1,
                    startLine: null,
                    originalLine: 1,
                    originalStartLine: null,
                    diffSide: 'RIGHT',
                    comments: {
                      nodes: [
                        {
                          id: 'c',
                          author: { login: 'a' },
                          body: 'BEFORE[2J[HAFTER',
                          createdAt: '',
                          isMinimized: false,
                        },
                      ],
                    },
                  },
                ],
              },
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 'g',
                    author: { login: 'b' },
                    body: '[31mred[0m text',
                    createdAt: '',
                  },
                ],
              },
            },
          },
        },
      });

      const result = await githubProvider.fetchCommentThreads!(
        {},
        { owner: 'o', repo: 'r' },
        1
      );

      expect(result.threads[0]!.comments[0]!.body).toBe('BEFOREAFTER');
      expect(result.generalComments[0]!.comments[0]!.body).toBe('red text');
    });
  });

  describe('replyToThread', () => {
    beforeEach(() => mockExecFile.mockReset());

    it('uses addPullRequestReviewThreadReply for review threads', async () => {
      ghSuccess({
        data: {
          addPullRequestReviewThreadReply: {
            comment: {
              id: 'reply-1',
              body: 'thanks',
              createdAt: '2026-01-01T00:00:00Z',
              author: { login: 'alice' },
            },
          },
        },
      });

      const reply = await githubProvider.replyToThread!(
        {},
        {},
        42,
        {
          id: 'thread-1',
          file: 'a.ts',
          lineStart: 1,
          lineEnd: 1,
          side: 'RIGHT',
          isResolved: false,
          isOutdated: false,
          canResolve: true,
          comments: [],
        },
        'thanks'
      );

      expect(reply).toEqual({
        id: 'reply-1',
        author: 'alice',
        body: 'thanks',
        createdAt: '2026-01-01T00:00:00Z',
      });

      expect(findQueryArg()).toContain('addPullRequestReviewThreadReply');
    });

    it('uses addComment with replySubjectId for issue-comment threads', async () => {
      ghSuccess({
        data: {
          addComment: {
            commentEdge: {
              node: {
                id: 'comment-1',
                body: 'reply body',
                createdAt: '2026-01-01T00:00:00Z',
                author: { login: 'bob' },
              },
            },
          },
        },
      });

      const reply = await githubProvider.replyToThread!(
        {},
        {},
        42,
        {
          id: 'general-1',
          file: null,
          lineStart: null,
          lineEnd: null,
          side: 'RIGHT',
          isResolved: false,
          isOutdated: false,
          canResolve: false,
          replyKind: 'github-issue-comment',
          replySubjectId: 'PR_NODE_ID',
          comments: [],
        },
        'reply body'
      );

      expect(reply.id).toBe('comment-1');
      expect(reply.body).toBe('reply body');
      expect(findQueryArg()).toContain('addComment');

      const args = mockExecFile.mock.calls[0]![1] as string[];
      expect(args).toContain('subjectId=PR_NODE_ID');
    });

    it('throws when an issue-comment thread is missing replySubjectId', async () => {
      await expect(
        githubProvider.replyToThread!(
          {},
          {},
          42,
          {
            id: 'general-1',
            file: null,
            lineStart: null,
            lineEnd: null,
            side: 'RIGHT',
            isResolved: false,
            isOutdated: false,
            canResolve: false,
            replyKind: 'github-issue-comment',
            // replySubjectId intentionally omitted
            comments: [],
          },
          'oops'
        )
      ).rejects.toThrow(/replySubjectId/);
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('strips ANSI from the reply body returned by GitHub', async () => {
      ghSuccess({
        data: {
          addPullRequestReviewThreadReply: {
            comment: {
              id: 'reply-1',
              body: 'plain[2Jpoison',
              createdAt: '',
              author: { login: 'a' },
            },
          },
        },
      });

      const reply = await githubProvider.replyToThread!(
        {},
        {},
        42,
        {
          id: 'thread-1',
          file: 'a.ts',
          lineStart: 1,
          lineEnd: 1,
          side: 'RIGHT',
          isResolved: false,
          isOutdated: false,
          canResolve: true,
          comments: [],
        },
        'thanks'
      );

      expect(reply.body).toBe('plainpoison');
    });
  });

  describe('setThreadResolved', () => {
    beforeEach(() => mockExecFile.mockReset());

    function makeThread(canResolve: boolean): RemoteCommentThread {
      return {
        id: 'thread-1',
        file: 'a.ts',
        lineStart: 1,
        lineEnd: 1,
        side: 'RIGHT',
        isResolved: false,
        isOutdated: false,
        canResolve,
        comments: [],
      };
    }

    it('uses resolveReviewThread when resolved=true', async () => {
      ghSuccess({
        data: {
          resolveReviewThread: { thread: { id: 't', isResolved: true } },
        },
      });
      await githubProvider.setThreadResolved!(
        {},
        {},
        42,
        makeThread(true),
        true
      );
      expect(findQueryArg()).toContain('resolveReviewThread');
    });

    it('uses unresolveReviewThread when resolved=false', async () => {
      ghSuccess({
        data: {
          unresolveReviewThread: { thread: { id: 't', isResolved: false } },
        },
      });
      await githubProvider.setThreadResolved!(
        {},
        {},
        42,
        makeThread(true),
        false
      );
      expect(findQueryArg()).toContain('unresolveReviewThread');
    });

    it('skips the mutation when canResolve is false', async () => {
      await githubProvider.setThreadResolved!(
        {},
        {},
        42,
        makeThread(false),
        true
      );
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });
});
