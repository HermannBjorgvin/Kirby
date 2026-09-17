import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostContext } from './comment-poster.js';
import type { ReviewComment } from './types.js';

/**
 * The one place n10 writes to somebody else's pull request.
 *
 * A wrong payload here is not a crash — it is a comment that lands on
 * the wrong line, or a review filed as the wrong kind, on a real pull
 * request other people are reading. Two rules in particular are policy
 * rather than mechanics: every comment says an agent wrote it, and a
 * comment is only marked posted once the provider has actually taken
 * it.
 */

const env = vi.hoisted(() => ({
  /** JSON handed to `gh` on stdin, per invocation. */
  ghInputs: [] as { args: string[]; body: unknown }[],
  ghExitCode: 0,
  /** Response body `gh api` prints to stdout when the call fails. */
  ghStdout: '',
  fetches: [] as { url: string; init: RequestInit }[],
  fetchOk: true,
  fetchStatus: 200,
  marked: [] as { id: string; patch: Record<string, unknown> }[],
}));

vi.mock('./comment-store.js', () => ({
  updateComment: (
    _prId: number,
    id: string,
    patch: Record<string, unknown>
  ) => {
    env.marked.push({ id, patch });
    return true;
  },
}));

vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write(s: string): void; end(): void };
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let input = '';
    child.stdin = {
      write: (s: string) => {
        input += s;
      },
      end: () => {
        env.ghInputs.push({ args, body: JSON.parse(input) });
        setImmediate(() => {
          if (env.ghExitCode !== 0) child.stderr.emit('data', 'gh failed');
          if (env.ghStdout) child.stdout.emit('data', env.ghStdout);
          child.emit('close', env.ghExitCode);
        });
      },
    };
    return child;
  },
}));

const { postReviewComments } = await import('./comment-poster.js');

function comment(over: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'c1',
    file: 'src/a.ts',
    lineStart: 10,
    lineEnd: 10,
    severity: 'major',
    body: 'This leaks a handle.',
    side: 'RIGHT',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const github: PostContext = {
  vendor: 'github',
  vendorAuth: {},
  vendorProject: { owner: 'acme', repo: 'widgets' },
  prId: 7,
  headSha: 'abc123',
};

const azure: PostContext = {
  vendor: 'azure-devops',
  vendorAuth: { pat: 'secret-pat' },
  vendorProject: { org: 'acme', project: 'proj', repo: 'widgets' },
  prId: 7,
};

beforeEach(() => {
  env.ghInputs = [];
  env.ghExitCode = 0;
  env.ghStdout = '';
  env.fetches = [];
  env.fetchOk = true;
  env.fetchStatus = 200;
  env.marked = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      env.fetches.push({ url, init });
      return Promise.resolve({
        ok: env.fetchOk,
        status: env.fetchStatus,
        text: () => Promise.resolve('provider said no'),
      });
    })
  );
});

describe('posting to GitHub', () => {
  it('files one review carrying every comment', async () => {
    await postReviewComments(
      [comment({ id: 'a' }), comment({ id: 'b' })],
      github
    );

    expect(env.ghInputs).toHaveLength(1);
    const body = env.ghInputs[0].body as { comments: unknown[] };
    expect(body.comments).toHaveLength(2);
    expect(env.ghInputs[0].args).toContain(
      'repos/acme/widgets/pulls/7/reviews'
    );
  });

  /**
   * The posted body is a Conventional Comment
   * (conventionalcomments.org) signed at the end: the severity becomes
   * the label and its decoration, so the first line says what kind of
   * remark this is and whether it blocks; the attribution goes where a
   * signature goes, rather than spending the comment's opening words —
   * the ones a reviewer sees in a notification — on a disclaimer.
   */
  it('posts the comment as a labelled, signed conventional comment', async () => {
    await postReviewComments([comment()], github);
    const body = env.ghInputs[0].body as { comments: { body: string }[] };
    expect(body.comments[0].body).toBe(
      'issue (non-blocking): This leaks a handle.\n\n---\n' +
        '_Posted via [n10](https://github.com/notaharness/n10) by an agent_'
    );
  });

  /** A reader must still be able to tell at a glance that this did not
   *  come from a person — just not before they can tell what it says. */
  it('signs every comment, and never in the opening words', async () => {
    await postReviewComments([comment()], github);
    const posted = (env.ghInputs[0].body as { comments: { body: string }[] })
      .comments[0].body;
    expect(posted).toContain('by an agent_');
    expect(posted.startsWith('AI generated')).toBe(false);
  });

  it('maps each severity onto its label and decoration', async () => {
    await postReviewComments(
      [
        comment({ id: 'a', severity: 'critical' }),
        comment({ id: 'b', severity: 'nit' }),
      ],
      github
    );
    const body = env.ghInputs[0].body as { comments: { body: string }[] };
    expect(body.comments[0].body).toContain('issue (blocking):');
    expect(body.comments[1].body).toContain('nitpick (non-blocking):');
  });

  /** The agent's own header is more specific than a four-value enum,
   *  so a draft already written in the shape keeps its wording. */
  it('keeps a header the agent wrote itself', async () => {
    await postReviewComments(
      [
        comment({
          severity: 'nit',
          body: 'question (blocking): why the retry here?\n\nIt looks unbounded.',
        }),
      ],
      github
    );
    const body = env.ghInputs[0].body as { comments: { body: string }[] };
    expect(body.comments[0].body).toContain(
      'question (blocking): why the retry here?'
    );
    expect(body.comments[0].body).toContain('It looks unbounded.');
    expect(body.comments[0].body).not.toContain('nitpick');
  });

  /** Ordinary prose can open with a label word. Reading it as a header
   *  turned a critical finding into the quietest label there is, so the
   *  declared severity wins and only the accidental label is replaced. */
  it('will not let an accidental label quieten the declared severity', async () => {
    await postReviewComments(
      [
        comment({
          severity: 'critical',
          body: 'Note: this drops writes on crash',
        }),
      ],
      github
    );
    const body = env.ghInputs[0].body as { comments: { body: string }[] };
    expect(body.comments[0].body).toContain(
      'issue (blocking): this drops writes on crash'
    );
    expect(body.comments[0].body).not.toContain('note:');
  });

  /** A comment that says nothing, under a header the app's own parser
   *  then refuses to read back. Checked for the whole batch first: a
   *  mid-batch throw would leave some comments live and some not. */
  it('refuses to post a draft with an empty body, before sending any', async () => {
    await expect(
      postReviewComments(
        [comment({ id: 'ok' }), comment({ id: 'blank', body: '   \n ' })],
        github
      )
    ).rejects.toThrow(/empty body: blank/);
    expect(env.ghInputs).toHaveLength(0);
  });

  /** A multi-line draft has a subject and a discussion; the split has
   *  to fall at the first line, not swallow the paragraph into the
   *  header. */
  it('makes the first line the subject and keeps the rest below it', async () => {
    await postReviewComments(
      [comment({ body: 'This leaks a handle.\nThe fd is never closed.' })],
      github
    );
    const body = env.ghInputs[0].body as { comments: { body: string }[] };
    expect(body.comments[0].body).toContain(
      'issue (non-blocking): This leaks a handle.\n\nThe fd is never closed.'
    );
  });

  it('anchors a single-line comment without a start line', async () => {
    // GitHub rejects `start_line` equal to `line`.
    await postReviewComments([comment({ lineStart: 10, lineEnd: 10 })], github);
    const c = (env.ghInputs[0].body as { comments: Record<string, unknown>[] })
      .comments[0];
    expect(c.line).toBe(10);
    expect('start_line' in c).toBe(false);
    expect(c.side).toBe('RIGHT');
  });

  it('spans a multi-line comment from its start to its end', async () => {
    await postReviewComments([comment({ lineStart: 4, lineEnd: 9 })], github);
    const c = (env.ghInputs[0].body as { comments: Record<string, unknown>[] })
      .comments[0];
    expect(c).toMatchObject({ start_line: 4, line: 9 });
  });

  /** A remark about the pull request as a whole has no line to sit
   *  on: it is filed as a review whose body is the comment. */
  it('files a whole-PR draft as a review whose body is the comment', async () => {
    await postReviewComments(
      [comment({ file: null, lineStart: null, lineEnd: null })],
      github
    );
    expect(env.ghInputs).toHaveLength(1);
    expect(env.ghInputs[0].args).toContain(
      'repos/acme/widgets/pulls/7/reviews'
    );
    const body = env.ghInputs[0].body as { body: string; comments?: unknown };
    expect(body.body).toContain('issue (non-blocking): This leaks a handle.');
    expect(body.comments).toBeUndefined();
  });

  /** The reviews endpoint has no file-level shape; the single-comment
   *  endpoint's `subject_type` is the only way to say "this file". */
  it('files a whole-file draft through the single-comment endpoint', async () => {
    await postReviewComments(
      [comment({ lineStart: null, lineEnd: null })],
      github
    );
    expect(env.ghInputs).toHaveLength(1);
    expect(env.ghInputs[0].args).toContain(
      'repos/acme/widgets/pulls/7/comments'
    );
    expect(env.ghInputs[0].body).toMatchObject({
      commit_id: 'abc123',
      path: 'src/a.ts',
      subject_type: 'file',
    });
    const body = env.ghInputs[0].body as Record<string, unknown>;
    expect('line' in body).toBe(false);
  });

  /** One verdict per batch, whatever mix of anchors carries it: a
   *  second review with APPROVE would approve the pull request twice. */
  it('puts the verdict on exactly one review across mixed anchors', async () => {
    await postReviewComments(
      [
        comment({ id: 'pr', file: null, lineStart: null, lineEnd: null }),
        comment({ id: 'line' }),
        comment({ id: 'file', lineStart: null, lineEnd: null }),
      ],
      github,
      'APPROVE'
    );
    const events = env.ghInputs.map(
      (i) => (i.body as { event?: string }).event
    );
    expect(events).toEqual(['APPROVE', 'COMMENT', undefined]);
  });

  /** The desktop posts drafts one at a time and files a verdict
   *  separately once every draft is live (see `postDraftComments`), so
   *  a single write never carries both a comment and a verdict. An
   *  empty batch has to be enough on its own to file the verdict. */
  it('files exactly one bare review for an empty batch carrying a verdict', async () => {
    await postReviewComments([], github, 'APPROVE');
    expect(env.ghInputs).toHaveLength(1);
    expect(env.ghInputs[0].args).toContain(
      'repos/acme/widgets/pulls/7/reviews'
    );
    expect(env.ghInputs[0].body).toMatchObject({ event: 'APPROVE' });
  });

  /** A batch of only whole-file drafts files no review of its own, so
   *  the verdict needs a bare one to ride on. */
  it('files a bare review for a verdict nothing else carried', async () => {
    await postReviewComments(
      [comment({ lineStart: null, lineEnd: null })],
      github,
      'REQUEST_CHANGES'
    );
    expect(env.ghInputs).toHaveLength(2);
    expect(env.ghInputs[1].args).toContain(
      'repos/acme/widgets/pulls/7/reviews'
    );
    expect(env.ghInputs[1].body).toMatchObject({ event: 'REQUEST_CHANGES' });
  });

  it('carries the head commit and the review verdict', async () => {
    await postReviewComments([comment()], github, 'REQUEST_CHANGES');
    expect(env.ghInputs[0].body).toMatchObject({
      commit_id: 'abc123',
      event: 'REQUEST_CHANGES',
    });
  });

  /** `gh api` puts the status line on stderr and the provider's
   *  explanation on stdout. A reviewer told only "HTTP 422" cannot
   *  tell a bad line anchor from a bad token. */
  it('reports the provider response body when gh fails', async () => {
    env.ghExitCode = 1;
    env.ghStdout =
      '{"message":"Unprocessable Entity","errors":["Line could not be resolved"]}';
    await expect(postReviewComments([comment()], github)).rejects.toThrow(
      /gh failed.*Line could not be resolved/
    );
  });

  it('refuses without a head commit rather than guessing one', async () => {
    // Comments anchor to a commit; the wrong one puts them on the wrong
    // lines.
    await expect(
      postReviewComments([comment()], { ...github, headSha: undefined })
    ).rejects.toThrow('headSha is required');
    expect(env.ghInputs).toEqual([]);
  });
});

describe('posting to Azure DevOps', () => {
  it('opens one thread per comment, anchored to the file and lines', async () => {
    await postReviewComments(
      [comment({ id: 'a', lineStart: 3, lineEnd: 5 })],
      azure
    );

    expect(env.fetches).toHaveLength(1);
    expect(env.fetches[0].url).toContain(
      'dev.azure.com/acme/proj/_apis/git/repositories/widgets/pullrequests/7/threads'
    );
    const body = JSON.parse(String(env.fetches[0].init.body)) as {
      threadContext: {
        filePath: string;
        rightFileStart: { line: number };
        rightFileEnd: { line: number };
      };
      comments: { content: string }[];
    };
    // Azure wants a repo-absolute path.
    expect(body.threadContext.filePath).toBe('/src/a.ts');
    expect(body.threadContext.rightFileStart.line).toBe(3);
    expect(body.threadContext.rightFileEnd.line).toBe(5);
    expect(body.comments[0].content).toContain('issue (non-blocking):');
    expect(body.comments[0].content).toContain('by an agent_');
  });

  /** A LEFT comment is anchored to a deleted line, which only exists
   *  on the old side of the diff; sending it as `rightFileStart` would
   *  point at whatever line now occupies that number in the new file. */
  it('anchors a LEFT comment to the old-file side', async () => {
    await postReviewComments(
      [comment({ side: 'LEFT', lineStart: 3, lineEnd: 5 })],
      azure
    );
    const body = JSON.parse(String(env.fetches[0].init.body)) as {
      threadContext: Record<string, { line: number }>;
    };
    expect(body.threadContext.leftFileStart.line).toBe(3);
    expect(body.threadContext.leftFileEnd.line).toBe(5);
    expect(body.threadContext.rightFileStart).toBeUndefined();
    expect(body.threadContext.rightFileEnd).toBeUndefined();
  });

  it('opens a whole-file thread with a path and no lines', async () => {
    await postReviewComments(
      [comment({ lineStart: null, lineEnd: null })],
      azure
    );
    const body = JSON.parse(String(env.fetches[0].init.body)) as {
      threadContext: Record<string, unknown>;
    };
    expect(body.threadContext).toEqual({ filePath: '/src/a.ts' });
  });

  /** Azure reads a thread with no context as a comment on the pull
   *  request itself. */
  it('opens a whole-PR thread with no thread context', async () => {
    await postReviewComments(
      [comment({ file: null, lineStart: null, lineEnd: null })],
      azure
    );
    const body = JSON.parse(String(env.fetches[0].init.body)) as Record<
      string,
      unknown
    >;
    expect('threadContext' in body).toBe(false);
  });

  it('sends the PAT as basic auth', async () => {
    await postReviewComments([comment()], azure);
    const headers = env.fetches[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa(':secret-pat')}`);
  });

  it('reports the provider status and body when it refuses', async () => {
    env.fetchOk = false;
    env.fetchStatus = 422;
    await expect(postReviewComments([comment()], azure)).rejects.toThrow(
      /422.*provider said no/
    );
  });
});

describe('marking comments posted', () => {
  it('marks them only after the provider took them', async () => {
    await postReviewComments(
      [comment({ id: 'a' }), comment({ id: 'b' })],
      github
    );
    expect(env.marked).toEqual([
      { id: 'a', patch: { status: 'posted' } },
      { id: 'b', patch: { status: 'posted' } },
    ]);
  });

  it('marks nothing when the post failed', async () => {
    // Marking early would lose the comment: it is neither on the pull
    // request nor still a draft to retry.
    env.ghExitCode = 1;
    await expect(postReviewComments([comment()], github)).rejects.toThrow();
    expect(env.marked).toEqual([]);
  });
});

describe('an unsupported provider', () => {
  it('is refused rather than silently doing nothing', async () => {
    await expect(
      postReviewComments([comment()], {
        ...github,
        vendor: 'gitlab' as never,
      })
    ).rejects.toThrow('Unsupported vendor: gitlab');
    expect(env.marked).toEqual([]);
  });
});
