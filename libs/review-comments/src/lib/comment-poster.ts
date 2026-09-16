import { spawn } from 'node:child_process';
import type { ReviewComment } from './types.js';
import {
  formatConventionalComment,
  resolveComment,
  withAgentFooter,
} from './conventional.js';
import { updateComment } from './comment-store.js';
import { commentAnchor } from './comment-anchor.js';

/**
 * What a failed `gh` call gets reported as.
 *
 * `gh api` writes only its one-line status to stderr ("gh:
 * Unprocessable Entity (HTTP 422)"); the provider's own explanation —
 * `"errors":["Line could not be resolved"]` — comes back on stdout as
 * the response body. Dropping stdout left the reviewer with a status
 * code and nothing to act on, so both streams go in the message.
 */
function describeFailure(
  cmd: string,
  code: number | null,
  stdout: string,
  stderr: string
): string {
  const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join(' ');
  return `${cmd} exited ${code}: ${detail}`;
}

function execWithStdin(
  cmd: string,
  args: string[],
  input: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      if (code !== 0)
        reject(new Error(describeFailure(cmd, code, stdout, stderr)));
      else resolve(stdout);
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * The body a draft is posted with.
 *
 * The severity and the body's own header are settled against each
 * other first (see `resolveComment`), so what a reviewer reads and what
 * every severity-driven surface in n10 shows cannot disagree.
 *
 * The attribution goes at the end, not the front. A comment's opening
 * words are the ones a reviewer sees in a notification and in a
 * collapsed thread, and spending them on provenance buries the finding
 * behind a disclaimer. The claim is still made — where a signature
 * goes.
 */
export function renderCommentBody(comment: ReviewComment): string {
  const { header } = resolveComment(comment.body, comment.severity);
  return withAgentFooter(formatConventionalComment(header));
}

/**
 * A draft with nothing in it cannot be posted.
 *
 * Without this the header is emitted with no subject — `issue
 * (blocking):` and nothing else — which is a comment that says
 * nothing, and which the app's own parser then refuses to read back as
 * a header, so it renders as literal prose. Checked for the whole batch
 * before anything is sent, because a mid-batch failure leaves some
 * comments live and some not.
 */
function assertPostable(comments: ReviewComment[]): void {
  const empty = comments.filter(
    (c) => resolveComment(c.body, c.severity).header.subject.length === 0
  );
  if (empty.length > 0) {
    throw new Error(
      `Cannot post ${empty.length === 1 ? 'a comment' : 'comments'} with an ` +
        `empty body: ${empty.map((c) => c.id).join(', ')}`
    );
  }
}

export interface PostContext {
  vendor: 'github' | 'azure-devops';
  vendorAuth: Record<string, string>;
  vendorProject: Record<string, string>;
  prId: number;
  headSha?: string;
}

export async function postReviewComments(
  comments: ReviewComment[],
  ctx: PostContext,
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES' = 'COMMENT'
): Promise<void> {
  assertPostable(comments);
  if (ctx.vendor === 'github') {
    await postGitHub(comments, ctx, event);
  } else if (ctx.vendor === 'azure-devops') {
    await postAzureDevOps(comments, ctx);
  } else {
    throw new Error(`Unsupported vendor: ${ctx.vendor}`);
  }

  // Mark all as posted
  for (const comment of comments) {
    updateComment(ctx.prId, comment.id, { status: 'posted' });
  }
}

type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

/** The body of a review that exists only to carry line comments or a
 *  verdict; the comments say the rest. */
const REVIEW_BODY = 'Review comments from an agent.';

function ghPost(path: string, payload: unknown): Promise<string> {
  return execWithStdin(
    'gh',
    ['api', path, '--input', '-'],
    JSON.stringify(payload)
  );
}

function lineCommentPayload(c: ReviewComment) {
  return {
    path: c.file,
    line: c.lineEnd,
    ...(c.lineStart !== c.lineEnd ? { start_line: c.lineStart } : {}),
    side: c.side,
    body: renderCommentBody(c),
  };
}

/**
 * GitHub takes the three anchors through two endpoints. Line comments
 * ride one review together; a whole-PR remark is a review of its own
 * whose body is the comment; a whole-file remark goes through the
 * single-comment endpoint, the only one that accepts `subject_type`.
 *
 * A verdict (approve / request changes) is filed on exactly one review
 * — repeating it would approve the pull request N times — and when
 * nothing else filed a review to carry it, a bare one does.
 */
async function postGitHub(
  comments: ReviewComment[],
  ctx: PostContext,
  event: ReviewEvent
): Promise<void> {
  if (!ctx.headSha) {
    throw new Error('headSha is required for GitHub reviews');
  }
  const { owner, repo } = ctx.vendorProject;
  const pulls = `repos/${owner}/${repo}/pulls/${ctx.prId}`;
  const commit_id = ctx.headSha;
  let verdict: ReviewEvent = event;
  const takeVerdict = (): ReviewEvent => {
    const e = verdict;
    verdict = 'COMMENT';
    return e;
  };

  for (const c of comments.filter((x) => commentAnchor(x) === 'pr')) {
    await ghPost(`${pulls}/reviews`, {
      commit_id,
      body: renderCommentBody(c),
      event: takeVerdict(),
    });
  }
  const lines = comments.filter((x) => commentAnchor(x) === 'line');
  if (lines.length > 0) {
    await ghPost(`${pulls}/reviews`, {
      commit_id,
      body: REVIEW_BODY,
      event: takeVerdict(),
      comments: lines.map(lineCommentPayload),
    });
  }
  for (const c of comments.filter((x) => commentAnchor(x) === 'file')) {
    await ghPost(`${pulls}/comments`, {
      commit_id,
      path: c.file,
      subject_type: 'file',
      body: renderCommentBody(c),
    });
  }
  if (verdict !== 'COMMENT') {
    await ghPost(`${pulls}/reviews`, {
      commit_id,
      body: REVIEW_BODY,
      event: takeVerdict(),
    });
  }
}

function azureThreadContext(comment: ReviewComment) {
  const anchor = commentAnchor(comment);
  if (anchor === 'pr') return {};
  const filePath = `/${comment.file}`;
  if (anchor === 'file') return { threadContext: { filePath } };
  return {
    threadContext: {
      filePath,
      rightFileStart: { line: comment.lineStart, offset: 1 },
      rightFileEnd: { line: comment.lineEnd, offset: 1 },
    },
  };
}

async function postAzureDevOps(
  comments: ReviewComment[],
  ctx: PostContext
): Promise<void> {
  const org = ctx.vendorProject.org;
  const project = ctx.vendorProject.project;
  const repo = ctx.vendorProject.repo;
  const pat = ctx.vendorAuth.pat;

  for (const comment of comments) {
    const thread = {
      comments: [
        {
          parentCommentId: 0,
          content: renderCommentBody(comment),
          commentType: 1,
        },
      ],
      // A thread with no context is a comment on the pull request;
      // one with only a path is a comment on that file.
      ...azureThreadContext(comment),
      status: 1, // active
    };

    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/pullrequests/${ctx.prId}/threads?api-version=7.1`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(':' + pat)}`,
      },
      body: JSON.stringify(thread),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Azure DevOps API ${response.status}: ${text}`);
    }
  }
}
