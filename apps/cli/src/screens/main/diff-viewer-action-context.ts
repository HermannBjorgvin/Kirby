import type { ReviewComment, PlanItem } from '@kirby/core';
import { snapshotLocal, snapshotRemote } from '@kirby/core';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import type { CommentPositionInfo } from '@kirby/review-comments';
import type { DiffViewerHandlerCtx } from './input-types.js';

// ── Helpers ──────────────────────────────────────────────────────

export function findAdjacentCommentId(
  direction: 'next' | 'prev',
  currentId: string | null,
  candidates: ReviewComment[],
  positions: Map<string, CommentPositionInfo> | undefined,
  filter?: (c: ReviewComment) => boolean
): string | undefined {
  const pool = filter ? candidates.filter(filter) : candidates;
  if (pool.length === 0) return undefined;

  if (positions && positions.size > 0) {
    const currentInfo = currentId ? positions.get(currentId) : undefined;
    const currentHeader =
      direction === 'next'
        ? currentInfo?.headerLine ?? -1
        : currentInfo?.headerLine ?? Infinity;

    const sorted = pool
      .map((c) => ({
        id: c.id,
        pos:
          positions.get(c.id)?.headerLine ??
          (direction === 'next' ? Infinity : -1),
      }))
      .sort((a, b) => (direction === 'next' ? a.pos - b.pos : b.pos - a.pos));

    const found =
      direction === 'next'
        ? sorted.find((c) => c.pos > currentHeader && c.id !== currentId)
        : sorted.find((c) => c.pos < currentHeader && c.id !== currentId);

    return (found ?? sorted[0])?.id;
  }

  const currentIdx = currentId
    ? pool.findIndex((c) => c.id === currentId)
    : direction === 'next'
    ? -1
    : 0;
  const nextIdx =
    direction === 'next'
      ? (currentIdx + 1) % pool.length
      : currentIdx <= 0
      ? pool.length - 1
      : currentIdx - 1;
  return pool[nextIdx]?.id;
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
