import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewComment } from '@kirby/review-comments';

/**
 * Draft posting is the one host path that mutates somebody else's
 * system, and its failure modes are expensive: a batch that dies
 * mid-way must not reset already-live comments back to draft (they
 * would be posted twice on retry), and a review *verdict* must ride
 * exactly one of the posts, or approving a PR with five comments files
 * five approvals.
 */

const state = vi.hoisted(() => ({
  comments: [] as ReviewComment[],
  config: {} as Record<string, unknown>,
  posts: [] as { ids: string[]; event: string }[],
  failOn: null as string | null,
}));

vi.mock('./repo.js', () => ({
  requireRepo: () => '/repo',
}));

vi.mock('@kirby/vcs-core', () => ({
  readConfig: () => state.config,
}));

vi.mock('@kirby/review-comments', () => ({
  readComments: () => state.comments.map((c) => ({ ...c })),
  updateComment: (_prId: number, id: string, patch: Partial<ReviewComment>) => {
    const found = state.comments.find((c) => c.id === id);
    if (!found) return false;
    Object.assign(found, patch);
    return true;
  },
  removeComment: (_prId: number, id: string) => {
    const before = state.comments.length;
    state.comments = state.comments.filter((c) => c.id !== id);
    return state.comments.length < before;
  },
  postReviewComments: (
    comments: ReviewComment[],
    _ctx: unknown,
    event: string
  ) => {
    const ids = comments.map((c) => c.id);
    state.posts.push({ ids, event });
    if (state.failOn && ids.includes(state.failOn)) {
      return Promise.reject(new Error('provider said no'));
    }
    for (const c of comments) {
      const found = state.comments.find((x) => x.id === c.id);
      if (found) found.status = 'posted';
    }
    return Promise.resolve(undefined);
  },
}));

const {
  deleteDraftComment,
  listDraftComments,
  postDraftComments,
  updateDraftComment,
} = await import('./drafts.js');

function draft(id: string, status: ReviewComment['status'] = 'draft') {
  return { id, status, body: `body ${id}` } as ReviewComment;
}

beforeEach(() => {
  state.comments = [draft('a'), draft('b'), draft('c')];
  state.config = { vendor: 'github', vendorAuth: {}, vendorProject: {} };
  state.posts = [];
  state.failOn = null;
});

describe('PR id validation', () => {
  // prId becomes a path segment under ~/.kirby/reviews, so anything
  // that isn't a positive integer could write outside that directory.
  it.each([
    ['a string', '../../etc'],
    ['a float', 1.5],
    ['zero', 0],
    ['a negative', -3],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(() => listDraftComments(value as number)).toThrow('Invalid PR id');
    expect(() => updateDraftComment(value as number, 'a', {})).toThrow(
      'Invalid PR id'
    );
    expect(() => deleteDraftComment(value as number, 'a')).toThrow(
      'Invalid PR id'
    );
  });

  it('accepts a positive integer', () => {
    expect(() => listDraftComments(42)).not.toThrow();
  });
});

describe('editing drafts', () => {
  it('refuses to edit or delete a comment that is already posted', () => {
    state.comments = [draft('a', 'posted')];
    expect(() => updateDraftComment(1, 'a', { body: 'x' })).toThrow(
      'already posted'
    );
    expect(() => deleteDraftComment(1, 'a')).toThrow('already posted');
  });

  it('refuses to edit a comment mid-post', () => {
    state.comments = [draft('a', 'posting')];
    expect(() => updateDraftComment(1, 'a', { body: 'x' })).toThrow(
      'being posted'
    );
  });

  it('reports a comment that no longer exists', () => {
    expect(() => updateDraftComment(1, 'gone', { body: 'x' })).toThrow(
      'no longer exists'
    );
  });
});

describe('postDraftComments', () => {
  it('posts one comment per call so a failure can only cost that one', async () => {
    const posted = await postDraftComments({ prId: 1, headSha: 'sha' });
    expect(posted).toBe(3);
    expect(state.posts.map((p) => p.ids)).toEqual([['a'], ['b'], ['c']]);
  });

  it('sends a verdict with the first post only', async () => {
    await postDraftComments({ prId: 1, headSha: 'sha', event: 'APPROVE' });
    // Repeating the event per comment would file three approvals.
    expect(state.posts.map((p) => p.event)).toEqual([
      'APPROVE',
      'COMMENT',
      'COMMENT',
    ]);
  });

  it('defaults to a plain comment event', async () => {
    await postDraftComments({ prId: 1, headSha: 'sha' });
    expect(new Set(state.posts.map((p) => p.event))).toEqual(
      new Set(['COMMENT'])
    );
  });

  it('posts only the requested ids', async () => {
    await postDraftComments({ prId: 1, headSha: 'sha', ids: ['c'] });
    expect(state.posts.map((p) => p.ids)).toEqual([['c']]);
  });

  it('skips comments that are already posted', async () => {
    state.comments = [draft('a', 'posted'), draft('b')];
    const posted = await postDraftComments({ prId: 1, headSha: 'sha' });
    expect(posted).toBe(1);
    expect(state.posts.map((p) => p.ids)).toEqual([['b']]);
  });

  it('returns zero without calling the provider when nothing is draft', async () => {
    state.comments = [draft('a', 'posted')];
    expect(await postDraftComments({ prId: 1, headSha: 'sha' })).toBe(0);
    expect(state.posts).toEqual([]);
  });

  it('leaves already-posted comments posted when a later one fails', async () => {
    state.failOn = 'b';
    await expect(
      postDraftComments({ prId: 1, headSha: 'sha' })
    ).rejects.toThrow('Posted 1 of 3, then failed: provider said no');

    const byId = Object.fromEntries(
      state.comments.map((c) => [c.id, c.status])
    );
    // 'a' is live on the provider — resetting it to draft would post it
    // a second time on retry. Only the failure goes back to draft.
    expect(byId).toEqual({ a: 'posted', b: 'draft', c: 'draft' });
  });

  it('reports the raw error when the very first post fails', async () => {
    state.failOn = 'a';
    await expect(
      postDraftComments({ prId: 1, headSha: 'sha' })
    ).rejects.toThrow('provider said no');
  });

  it('refuses to post without a configured provider', async () => {
    state.config = {};
    await expect(postDraftComments({ prId: 1 })).rejects.toThrow(
      'No VCS provider configured'
    );
  });

  it('refuses an unsupported provider', async () => {
    state.config = { vendor: 'gitlab' };
    await expect(postDraftComments({ prId: 1 })).rejects.toThrow(
      'Unsupported vendor: gitlab'
    );
  });

  it('requires a head SHA on GitHub, where comments anchor to a commit', async () => {
    await expect(postDraftComments({ prId: 1 })).rejects.toThrow(
      'Missing head SHA'
    );
  });

  it('does not require a head SHA on Azure DevOps', async () => {
    state.config = { vendor: 'azure-devops', vendorAuth: {} };
    await expect(postDraftComments({ prId: 1 })).resolves.toBe(3);
  });
});
