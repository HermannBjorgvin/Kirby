import { randomUUID } from 'node:crypto';
import {
  commentableLines,
  lineAnchorProblem,
  type CommentableLines,
} from '@n10/core';
import {
  appendComment,
  resolveComment,
  type CommentSeverity,
  type ReviewComment,
} from '@n10/review-comments';

const VALID_SEVERITIES = new Set<CommentSeverity>([
  'critical',
  'major',
  'minor',
  'nit',
]);

export function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w+)=(.+)$/s);
    if (match) {
      let value = match[2];
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      result[match[1]] = value;
    }
  }
  return result;
}

const USAGE =
  'Usage: n10 util add-comment --pr=<id> --severity=<critical|major|minor|nit> --body=<text> ' +
  '[--file=<path> [--lineStart=<n> --lineEnd=<n>]] [--side=LEFT|RIGHT] [--base=<branch>] [--thread=<id>]';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

type Anchor = Pick<ReviewComment, 'file' | 'lineStart' | 'lineEnd'>;

/**
 * Where the draft goes: lines in a file, a whole file, or the pull
 * request itself — `--file` with both lines, `--file` alone, or
 * neither. Half an anchor is a mistake, not a shape.
 */
function parseAnchor(parsed: Record<string, string>): Anchor {
  const file = parsed.file || null;
  const hasStart = parsed.lineStart !== undefined;
  const hasEnd = parsed.lineEnd !== undefined;
  if (hasStart !== hasEnd) {
    fail('--lineStart and --lineEnd go together: give both, or neither');
  }
  if (!hasStart) return { file, lineStart: null, lineEnd: null };
  if (file === null) {
    fail(
      '--lineStart/--lineEnd need --file to say which file the lines are in'
    );
  }
  const lineStart = parseInt(parsed.lineStart, 10);
  const lineEnd = parseInt(parsed.lineEnd, 10);
  if (
    isNaN(lineStart) ||
    isNaN(lineEnd) ||
    lineStart < 1 ||
    lineEnd < lineStart
  ) {
    fail(
      '--lineStart and --lineEnd must be line numbers, with lineEnd >= lineStart'
    );
  }
  return { file, lineStart, lineEnd };
}

/**
 * Refuse a line anchor the provider would refuse, while the agent can
 * still choose another. Needs the target branch (`--base`) to find the
 * diff; without it, or when the branch cannot be resolved here, the
 * draft is taken on trust and the post may fail later instead.
 */
async function checkLineAnchor(
  base: string | undefined,
  anchor: Anchor,
  side: 'LEFT' | 'RIGHT'
): Promise<void> {
  if (!base || anchor.file === null) return;
  if (anchor.lineStart === null || anchor.lineEnd === null) return;
  let lines: CommentableLines | null;
  try {
    lines = await commentableLines({
      cwd: process.cwd(),
      targetBranch: base,
      file: anchor.file,
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.error(
      `warning: could not check the anchor against the diff (${why}); ` +
        `the draft is recorded unchecked`
    );
    return;
  }
  const problem = lineAnchorProblem(lines, {
    file: anchor.file,
    side,
    lineStart: anchor.lineStart,
    lineEnd: anchor.lineEnd,
  });
  if (problem) fail(problem);
}

async function handleAddComment(args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  const missing = ['pr', 'severity', 'body'].filter((f) => !parsed[f]);
  if (missing.length > 0) {
    console.error(`Missing required fields: ${missing.join(', ')}`);
    fail(USAGE);
  }

  const severity = parsed.severity as CommentSeverity;
  if (!VALID_SEVERITIES.has(severity)) {
    fail(
      `Invalid severity "${parsed.severity}". Must be: critical, major, minor, nit`
    );
  }

  const side = (parsed.side as 'LEFT' | 'RIGHT') ?? 'RIGHT';
  if (side !== 'LEFT' && side !== 'RIGHT') {
    fail('Invalid side. Must be LEFT or RIGHT');
  }

  const prId = parseInt(parsed.pr, 10);
  if (isNaN(prId)) {
    fail('--pr must be a number');
  }

  const anchor = parseAnchor(parsed);
  await checkLineAnchor(parsed.base, anchor, side);

  const comment: ReviewComment = {
    id: randomUUID(),
    ...anchor,
    // A body that opens with its own Conventional Comments header is
    // stating a severity too, and the two must not be able to
    // disagree — the louder wins. Settled once, here, so everything
    // that reads the stored draft (the walkthrough order, the rail
    // dot, the TUI chip, the posted body) says the same thing.
    severity: resolveComment(parsed.body, severity).severity,
    body: parsed.body,
    side,
    status: 'draft',
    createdAt: new Date().toISOString(),
    // Optional: the provider's id for the review thread this draft
    // answers. Recorded so the reader (and a later agent reading the
    // plan) can see which conversation the draft is about; posting
    // still opens a new thread at --file/--lineStart.
    ...(parsed.thread ? { threadId: parsed.thread } : {}),
  };

  appendComment(prId, comment);
  console.log(comment.id);
}

export async function handleUtilCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === 'add-comment') {
    await handleAddComment(args.slice(1));
    return;
  }

  console.error(`Unknown util subcommand: ${subcommand}`);
  console.error('Available subcommands: add-comment');
  process.exit(1);
}
