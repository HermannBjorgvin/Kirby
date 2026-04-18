import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewComment } from '@kirby/review-comments';
import type * as ReviewCommentsModule from '@kirby/review-comments';

// Mock comment-store before importing the module under test
vi.mock('@kirby/review-comments', async (importOriginal) => {
  const actual = await importOriginal<typeof ReviewCommentsModule>();
  return {
    ...actual,
    updateComment: vi.fn(),
  };
});

const { postReviewComments } = await import('@kirby/review-comments');

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeComment(overrides?: Partial<ReviewComment>): ReviewComment {
  return {
    id: 'c1',
    file: 'src/foo.ts',
    lineStart: 10,
    lineEnd: 12,
    severity: 'major',
    body: 'Fix this',
    side: 'RIGHT',
    status: 'draft',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('postAzureDevOps via fetch()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends correct URL, auth header, and thread body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    });

    const comment = makeComment();
    await postReviewComments([comment], {
      vendor: 'azure-devops',
      vendorAuth: { pat: 'my-pat' },
      vendorProject: { org: 'myorg', project: 'myproj', repo: 'myrepo' },
      prId: 42,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://dev.azure.com/myorg/myproj/_apis/git/repositories/myrepo/pullrequests/42/threads?api-version=7.1'
    );
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['Authorization']).toBe(`Basic ${btoa(':my-pat')}`);

    const body = JSON.parse(opts.body);
    expect(body.comments[0].content).toContain('AI generated:');
    expect(body.threadContext.filePath).toBe('/src/foo.ts');
    expect(body.threadContext.rightFileStart.line).toBe(10);
    expect(body.threadContext.rightFileEnd.line).toBe(12);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(
      postReviewComments([makeComment()], {
        vendor: 'azure-devops',
        vendorAuth: { pat: 'bad' },
        vendorProject: { org: 'o', project: 'p', repo: 'r' },
        prId: 1,
      })
    ).rejects.toThrow('Azure DevOps API 401');
  });
});

describe('postReviewComments vendor guard', () => {
  it('throws for unsupported vendor', async () => {
    await expect(
      postReviewComments([makeComment()], {
        vendor: 'gitlab' as 'github',
        vendorAuth: {},
        vendorProject: {},
        prId: 1,
      })
    ).rejects.toThrow('Unsupported vendor: gitlab');
  });

  it('throws when GitHub is missing headSha', async () => {
    await expect(
      postReviewComments([makeComment()], {
        vendor: 'github',
        vendorAuth: {},
        vendorProject: { owner: 'o', repo: 'r' },
        prId: 1,
      })
    ).rejects.toThrow('headSha is required');
  });
});
