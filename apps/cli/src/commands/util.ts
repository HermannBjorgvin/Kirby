import { randomUUID } from 'node:crypto';
import { appendComment } from '../utils/comment-store.js';
import type { CommentSeverity, ReviewComment } from '../types.js';

const VALID_SEVERITIES = new Set<CommentSeverity>([
  'critical',
  'major',
  'minor',
  'nit',
]);

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

function handleAddComment(args: string[]): void {
  const parsed = parseArgs(args);

  const missing: string[] = [];
  for (const field of [
    'pr',
    'file',
    'lineStart',
    'lineEnd',
    'severity',
    'body',
  ]) {
    if (!parsed[field]) missing.push(field);
  }
  if (missing.length > 0) {
    console.error(`Missing required fields: ${missing.join(', ')}`);
    console.error(
      'Usage: kirby util add-comment --pr=<id> --file=<path> --lineStart=<n> --lineEnd=<n> --severity=<critical|major|minor|nit> --body=<text> [--side=LEFT|RIGHT]'
    );
    process.exit(1);
  }

  const severity = parsed.severity as CommentSeverity;
  if (!VALID_SEVERITIES.has(severity)) {
    console.error(
      `Invalid severity "${parsed.severity}". Must be: critical, major, minor, nit`
    );
    process.exit(1);
  }

  const side = (parsed.side as 'LEFT' | 'RIGHT') ?? 'RIGHT';
  if (side !== 'LEFT' && side !== 'RIGHT') {
    console.error('Invalid side. Must be LEFT or RIGHT');
    process.exit(1);
  }

  const prId = parseInt(parsed.pr, 10);
  if (isNaN(prId)) {
    console.error('--pr must be a number');
    process.exit(1);
  }

  const lineStart = parseInt(parsed.lineStart, 10);
  const lineEnd = parseInt(parsed.lineEnd, 10);
  if (isNaN(lineStart) || isNaN(lineEnd)) {
    console.error('--lineStart and --lineEnd must be numbers');
    process.exit(1);
  }

  const comment: ReviewComment = {
    id: randomUUID(),
    file: parsed.file,
    lineStart,
    lineEnd,
    severity,
    body: parsed.body,
    side,
    status: 'draft',
    createdAt: new Date().toISOString(),
  };

  appendComment(prId, comment);
  console.log(comment.id);
}

export async function handleUtilCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === 'add-comment') {
    handleAddComment(args.slice(1));
    return;
  }

  console.error(`Unknown util subcommand: ${subcommand}`);
  console.error('Available subcommands: add-comment');
  process.exit(1);
}
