import { spawn } from 'node:child_process';
import type { ReviewComment } from '../types.js';
import { updateComment } from './comment-store.js';

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
      if (code !== 0) reject(new Error(`${cmd} exited ${code}: ${stderr}`));
      else resolve(stdout);
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

export interface PostContext {
  vendor: string;
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

async function postGitHub(
  comments: ReviewComment[],
  ctx: PostContext,
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
): Promise<void> {
  if (!ctx.headSha) {
    throw new Error('headSha is required for GitHub reviews');
  }
  const owner = ctx.vendorProject.owner;
  const repo = ctx.vendorProject.repo;

  const reviewBody = {
    commit_id: ctx.headSha,
    body: 'AI-assisted review comments',
    event,
    comments: comments.map((c) => ({
      path: c.file,
      line: c.lineEnd,
      ...(c.lineStart !== c.lineEnd ? { start_line: c.lineStart } : {}),
      side: c.side,
      body: `AI generated: **[${c.severity}]** ${c.body}`,
    })),
  };

  const jsonInput = JSON.stringify(reviewBody);
  await execWithStdin(
    'gh',
    ['api', `repos/${owner}/${repo}/pulls/${ctx.prId}/reviews`, '--input', '-'],
    jsonInput
  );
}

async function postAzureDevOps(
  comments: ReviewComment[],
  ctx: PostContext
): Promise<void> {
  const org = ctx.vendorProject.org;
  const project = ctx.vendorProject.project;
  const repo = ctx.vendorProject.repo;

  for (const comment of comments) {
    const thread = {
      comments: [
        {
          parentCommentId: 0,
          content: `AI generated: **[${comment.severity}]** ${comment.body}`,
          commentType: 1,
        },
      ],
      threadContext: {
        filePath: `/${comment.file}`,
        rightFileStart: {
          line: comment.lineStart,
          offset: 1,
        },
        rightFileEnd: {
          line: comment.lineEnd,
          offset: 1,
        },
      },
      status: 1, // active
    };

    const jsonInput = JSON.stringify(thread);
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${repo}/pullrequests/${ctx.prId}/threads?api-version=7.1`;
    const pat = ctx.vendorAuth.pat;

    await execWithStdin(
      'curl',
      [
        '-s',
        '-X',
        'POST',
        '-H',
        'Content-Type: application/json',
        '-u',
        `:${pat}`,
        '--data-binary',
        '@-',
        url,
      ],
      jsonInput
    );
  }
}
