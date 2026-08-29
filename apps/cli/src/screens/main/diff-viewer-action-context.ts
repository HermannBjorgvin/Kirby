import type { ReviewComment, PlanItem } from '@kirby/core';
import { snapshotLocal, snapshotRemote } from '@kirby/core';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import type { CommentPositionInfo } from '@kirby/review-comments';
import type { DiffViewerHandlerCtx } from './input-types.js';

// ── Helpers ──────────────────────────────────────────────────────

/** Walking the comments forwards and backwards is the same walk with
 *  every comparison mirrored, so the direction is named once here
 *  instead of being re-decided on each line of the search. */
interface CommentWalk {
  /** Sorts header lines into visiting order. */
  order: (a: number, b: number) => number;
  /** True when `pos` lies ahead of the current selection. */
  ahead: (pos: number, current: number) => boolean;
  /** Where a comment with no known header line sorts to — the far end,
   *  so an unplaced comment is reached last rather than first. */
  unplaced: number;
  /** Stands in for the current header line when nothing is selected. */
  origin: number;
  /** Index the walk starts from when nothing is selected. */
  originIndex: number;
  /** One step on from `from`, wrapping at the ends. */
  step: (from: number, length: number) => number;
}

const WALKS: Record<'next' | 'prev', CommentWalk> = {
  next: {
    order: (a, b) => a - b,
    ahead: (pos, current) => pos > current,
    unplaced: Infinity,
    origin: -1,
    originIndex: -1,
    step: (from, length) => (from + 1) % length,
  },
  prev: {
    order: (a, b) => b - a,
    ahead: (pos, current) => pos < current,
    unplaced: -1,
    origin: Infinity,
    originIndex: 0,
    step: (from, length) => (from <= 0 ? length - 1 : from - 1),
  },
};

/** Rendered order: comments are visited by the line they are anchored
 *  to, so the walk follows what the reader sees. Falls off the end
 *  onto the first entry, making the walk cyclic. */
function findByHeaderLine(
  walk: CommentWalk,
  currentId: string | null,
  pool: ReviewComment[],
  positions: Map<string, CommentPositionInfo>
): string | undefined {
  const currentHeader =
    (currentId ? positions.get(currentId) : undefined)?.headerLine ??
    walk.origin;

  const sorted = pool
    .map((c) => ({
      id: c.id,
      pos: positions.get(c.id)?.headerLine ?? walk.unplaced,
    }))
    .sort((a, b) => walk.order(a.pos, b.pos));

  const found = sorted.find(
    (c) => walk.ahead(c.pos, currentHeader) && c.id !== currentId
  );
  return (found ?? sorted[0])?.id;
}

/** Fallback for a file whose rows have not been measured yet: walk the
 *  candidate list in the order it arrived. */
function findByListIndex(
  walk: CommentWalk,
  currentId: string | null,
  pool: ReviewComment[]
): string | undefined {
  const currentIdx = currentId
    ? pool.findIndex((c) => c.id === currentId)
    : walk.originIndex;
  return pool[walk.step(currentIdx, pool.length)]?.id;
}

export function findAdjacentCommentId(
  direction: 'next' | 'prev',
  currentId: string | null,
  candidates: ReviewComment[],
  positions: Map<string, CommentPositionInfo> | undefined,
  filter?: (c: ReviewComment) => boolean
): string | undefined {
  const pool = filter ? candidates.filter(filter) : candidates;
  if (pool.length === 0) return undefined;

  const walk = WALKS[direction];
  return positions && positions.size > 0
    ? findByHeaderLine(walk, currentId, pool, positions)
    : findByListIndex(walk, currentId, pool);
}

export function scrollToComment(
  commentId: string,
  ctx: DiffViewerHandlerCtx,
  maxScroll: number
) {
  const positions = ctx.commentCtx?.positions;
  if (!positions) return;
  const info = positions.get(commentId);
  if (!info) return;
  // info.refStartLine is a slot index — translate to a physical row
  // via the row map before scrolling. Pin two rows above for code
  // context.
  const rowEntry = ctx.rowMap.positions[info.refStartLine];
  if (!rowEntry) return;
  const scrollTarget = Math.max(0, rowEntry.rowStart - 2);
  ctx.pane.setDiffScrollOffset(Math.min(scrollTarget, maxScroll));
}

// ── Action context ───────────────────────────────────────────────

/** Values every action handler shares, computed once per keypress. */
export interface DiffViewerActionCtx {
  ctx: DiffViewerHandlerCtx;
  viewportHeight: number;
  maxScroll: number;
  /** Local drafts on the open file. Posted ones are excluded: they
   *  render via the remote-thread path (see interleaveComments), so
   *  keyboard navigation must not land on an invisible local entry. */
  fileComments: ReviewComment[];
}

export type DiffViewerAction = (a: DiffViewerActionCtx) => void;

interface CommentNavEntry {
  id: string;
  lineStart: number;
  kind: 'local' | 'remote';
}

/** Local drafts and remote threads in one line-sorted pool. Walking
 *  them separately lets a single draft gate off remote threads
 *  entirely, making those threads unreachable. */
export function commentNavPool({
  ctx,
  fileComments,
}: DiffViewerActionCtx): CommentNavEntry[] {
  return [
    ...fileComments.map((c) => ({
      id: c.id,
      lineStart: c.lineStart ?? Number.POSITIVE_INFINITY,
      kind: 'local' as const,
    })),
    ...(ctx.remoteCtx?.threads ?? []).map((t) => ({
      id: t.id,
      lineStart: t.lineStart ?? Number.POSITIVE_INFINITY,
      kind: 'remote' as const,
    })),
  ].sort((a, b) => a.lineStart - b.lineStart);
}

/** The selection, when it refers to a local draft. Comment actions
 *  guard on this: pressing 'x' on a remote thread would otherwise
 *  enter an invisible delete-confirm trap (renderRemoteThread draws no
 *  y/n prompt). */
export function selectedLocalComment({
  ctx,
  fileComments,
}: DiffViewerActionCtx): ReviewComment | undefined {
  return ctx.pane.selectedCommentId
    ? fileComments.find((c) => c.id === ctx.pane.selectedCommentId)
    : undefined;
}

/** The selection, when it refers to a remote thread. */
export function selectedRemoteThread({
  ctx,
}: DiffViewerActionCtx): RemoteCommentThread | undefined {
  return ctx.remoteCtx?.threads.find(
    (t) => t.id === ctx.pane.selectedCommentId
  );
}

/** The selection as a plan snapshot — local draft or remote thread.
 *  Both feed the same per-PR plan. */
export function selectedPlanTarget(a: DiffViewerActionCtx): PlanItem | null {
  const local = selectedLocalComment(a);
  if (local) return snapshotLocal(local);
  const remote = selectedRemoteThread(a);
  return remote ? snapshotRemote(remote) : null;
}
