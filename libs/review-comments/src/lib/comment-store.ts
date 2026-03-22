import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ReviewComment, ReviewCommentsFile } from './types.js';

const KIRBY_DIR = join(homedir(), '.kirby');

export function commentDirPath(prId: number): string {
  return join(KIRBY_DIR, 'reviews', `pr-${prId}`);
}

export function commentFilePath(prId: number): string {
  return join(commentDirPath(prId), 'comments.json');
}

export function readComments(prId: number): ReviewComment[] {
  try {
    const data = readFileSync(commentFilePath(prId), 'utf8');
    const parsed: ReviewCommentsFile = JSON.parse(data);
    return parsed.comments ?? [];
  } catch {
    return [];
  }
}

function writeCommentsAtomic(prId: number, comments: ReviewComment[]): void {
  const dir = commentDirPath(prId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = commentFilePath(prId);
  const tmpPath = filePath + '.tmp';
  const data: ReviewCommentsFile = { prId, comments };
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
}

export function appendComment(prId: number, comment: ReviewComment): void {
  const comments = readComments(prId);
  comments.push(comment);
  writeCommentsAtomic(prId, comments);
}

export function updateComment(
  prId: number,
  id: string,
  patch: Partial<ReviewComment>
): boolean {
  const comments = readComments(prId);
  const idx = comments.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  comments[idx] = { ...comments[idx], ...patch };
  writeCommentsAtomic(prId, comments);
  return true;
}

export function removeComment(prId: number, id: string): boolean {
  const comments = readComments(prId);
  const idx = comments.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  comments.splice(idx, 1);
  writeCommentsAtomic(prId, comments);
  return true;
}
