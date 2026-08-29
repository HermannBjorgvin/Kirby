import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteCommentThread } from '@kirby/vcs-core';

/**
 * Review calls have two jobs beyond forwarding to a provider.
 *
 * They validate: a PR id arrives from the sandboxed renderer — which
 * renders pull request markdown and provider-hosted images — and ends
 * up interpolated into a provider API path, so it is checked
 * structurally rather than trusted.
 *
 * And they degrade: a repo with no provider, or one that isn't
 * authenticated, is first-class. Reading returns nothing instead of
 * erroring (the TUI's usePrData does the same), while an action the
 * user explicitly took has to fail loudly rather than vanish.
 */

const env = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  configured: true,
  /** Provider capabilities present on the object. */
  capabilities: {
    comments: true,
    replies: true,
    resolve: true,
    description: true,
    verdicts: true,
  },
  calls: [] as { method: string; args: unknown[] }[],
}));

vi.mock('@kirby/core', () => ({
  fetchDiffText: (...args: unknown[]) => {
    env.calls.push({ method: 'fetchDiffText', args });
    return Promise.resolve('diff');
  },
  fetchFileDiffText: (...args: unknown[]) => {
    env.calls.push({ method: 'fetchFileDiffText', args });
    return Promise.resolve('file diff');
  },
}));

vi.mock('@kirby/vcs-core', () => ({ readConfig: () => env.config }));

vi.mock('./repo.js', () => {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      env.calls.push({ method, args });
      return Promise.resolve(method === 'fetchPullRequests' ? {} : undefined);
    };
  return {
    requireRepo: () => '/repo',
    get PROVIDERS() {
      const p: Record<string, unknown> = {
        id: 'github',
        isConfigured: () => env.configured,
        fetchPullRequests: record('fetchPullRequests'),
      };
      if (env.capabilities.comments) {
        p.fetchCommentThreads = record('fetchCommentThreads');
      }
      if (env.capabilities.replies) p.replyToThread = record('replyToThread');
      if (env.capabilities.resolve) {
        p.setThreadResolved = record('setThreadResolved');
      }
      if (env.capabilities.description) {
        p.fetchPullRequestDescription = record('fetchPullRequestDescription');
      }
      if (env.capabilities.verdicts) {
        p.submitReviewVerdict = record('submitReviewVerdict');
      }
      return [p];
    },
  };
});

const {
  fetchCommentThreads,
  fetchPrDescription,
  fetchPullRequests,
  getDiffText,
  getFileDiffText,
  getReviewViewer,
  replyToThread,
  setThreadResolved,
  submitReviewVerdict,
} = await import('./reviews.js');

beforeEach(() => {
  env.config = {
    vendor: 'github',
    vendorAuth: { token: 'tok' },
    vendorProject: { repo: 'kirby', username: 'hermann' },
  };
  env.configured = true;
  env.capabilities = {
    comments: true,
    replies: true,
    resolve: true,
    description: true,
    verdicts: true,
  };
  env.calls = [];
});

const called = (method: string) => env.calls.filter((c) => c.method === method);

/** Only the identity matters here; the provider mock records it verbatim. */
const THREAD = { id: 't' } as unknown as RemoteCommentThread;

describe('PR id validation', () => {
  it.each([
    ['a string', '7 OR 1=1'],
    ['a path', '../../admin'],
    ['a float', 2.5],
    ['zero', 0],
    ['a negative', -1],
  ])('refuses %s before it reaches the provider', async (_label, value) => {
    await expect(fetchPrDescription(value as number)).rejects.toThrow(
      'Invalid PR id'
    );
    await expect(
      submitReviewVerdict(value as number, 'approve')
    ).rejects.toThrow('Invalid PR id');
    expect(env.calls).toEqual([]);
  });
});

describe('verdicts', () => {
  it('accepts each verdict the UI can produce', async () => {
    for (const v of [
      'approve',
      'approve-with-suggestions',
      'wait-for-author',
      'reject',
    ] as const) {
      await submitReviewVerdict(1, v);
    }
    expect(called('submitReviewVerdict').map((c) => c.args[3])).toEqual([
      'approve',
      'approve-with-suggestions',
      'wait-for-author',
      'reject',
    ]);
  });

  it('refuses a verdict outside the allowlist', async () => {
    await expect(
      submitReviewVerdict(1, 'merge-it-now' as never)
    ).rejects.toThrow('Invalid review verdict');
    expect(called('submitReviewVerdict')).toEqual([]);
  });

  it('fails loudly when no provider is configured', async () => {
    env.configured = false;
    // Unlike reads, a verdict is something the user pressed a button
    // for; swallowing it would look like it had been filed.
    await expect(submitReviewVerdict(1, 'approve')).rejects.toThrow(
      'No review provider is configured'
    );
  });

  it('reports a provider that cannot submit verdicts', async () => {
    env.capabilities.verdicts = false;
    await expect(submitReviewVerdict(1, 'approve')).rejects.toThrow(
      'does not support review verdicts'
    );
  });
});

describe('degrading without a provider', () => {
  beforeEach(() => {
    env.config = {};
  });

  it('returns nothing rather than erroring on reads', async () => {
    // A repo with no remote is first-class; review features just go
    // quiet, the way the TUI's usePrData does.
    expect(await fetchPullRequests()).toEqual({});
    expect(await fetchCommentThreads(1)).toEqual({
      threads: [],
      generalComments: [],
    });
    expect(await fetchPrDescription(1)).toBe('');
    expect(env.calls).toEqual([]);
  });

  it('quietly no-ops writes to threads', async () => {
    await replyToThread({ prId: 1, thread: THREAD, body: 'hi' });
    await setThreadResolved({ prId: 1, thread: THREAD, resolved: true });
    expect(env.calls).toEqual([]);
  });

  it('also goes quiet when a provider exists but is not authenticated', async () => {
    env.config = { vendor: 'github' };
    env.configured = false;
    expect(await fetchPullRequests()).toEqual({});
  });
});

describe('provider capability gaps', () => {
  it('names the missing capability instead of throwing a type error', async () => {
    env.capabilities = {
      comments: false,
      replies: false,
      resolve: false,
      description: false,
      verdicts: true,
    };
    await expect(fetchCommentThreads(1)).rejects.toThrow(
      'does not support comments'
    );
    await expect(
      replyToThread({ prId: 1, thread: THREAD, body: 'hi' })
    ).rejects.toThrow('does not support replies');
    await expect(
      setThreadResolved({ prId: 1, thread: THREAD, resolved: true })
    ).rejects.toThrow('does not support thread resolution');
  });

  it('treats a missing description as empty, not as a failure', async () => {
    // Descriptions are decoration — a provider without them should
    // render an empty overview, not break the pull request tab.
    env.capabilities.description = false;
    expect(await fetchPrDescription(1)).toBe('');
  });
});

describe('credentials', () => {
  it('passes the configured auth and project through to the provider', async () => {
    await fetchCommentThreads(7);
    expect(called('fetchCommentThreads')[0].args).toEqual([
      { token: 'tok' },
      { repo: 'kirby', username: 'hermann' },
      7,
    ]);
  });
});

describe('getReviewViewer', () => {
  it('uses the GitHub username, which is what its reviewer lists carry', () => {
    expect(getReviewViewer()).toEqual({ identifier: 'hermann' });
  });

  it('uses the configured email for other providers', () => {
    env.config = { vendor: 'azure-devops', email: 'me@example.test' };
    expect(getReviewViewer()).toEqual({ identifier: 'me@example.test' });
  });

  it('is null when nothing identifies the viewer', () => {
    // The renderer uses this to patch its own reviewer row optimistically;
    // a wrong guess would mark the wrong person.
    env.config = { vendor: 'github', vendorProject: {} };
    expect(getReviewViewer()).toBeNull();
  });
});

describe('diffs', () => {
  it('reads from git without needing a provider at all', async () => {
    env.config = {};
    expect(await getDiffText('feature', 'main')).toBe('diff');
    expect(await getFileDiffText('feature', 'main', 'a.ts')).toBe('file diff');
    expect(called('fetchDiffText')[0].args).toEqual(['feature', 'main']);
    expect(called('fetchFileDiffText')[0].args).toEqual([
      'feature',
      'main',
      'a.ts',
    ]);
  });
});
