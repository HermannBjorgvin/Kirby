import { useCallback, useMemo, useRef, useState } from 'react';
import type { DiffLine } from '@kirby/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../../host/contract.js';
import type { CommentListItem } from '../../components/review/CommentsList.js';
import type { DiffJumpHandle } from '../../components/review/VirtualDiffList.js';
import {
  buildCommentRows,
  navIndexOf,
  stepComment,
  visibleComments,
  type CommentRow,
} from './review-model.js';

/**
 * Walking the comments on a pull request: one document-ordered list,
 * where the viewer is in it, and how to get the diff to show any of
 * them.
 *
 * It is one hook because the rail's comment list and the diff toolbar's
 * prev/next both read it, and they used to disagree about what "the
 * next comment" meant — the list is filtered once, here, and both take
 * the result.
 */
export function useCommentNavigator({
  files,
  general,
  inlineThreads,
  drafts,
  hideResolved,
  onShowDiff,
}: {
  files: readonly [string, DiffLine[]][];
  general: readonly RemoteCommentThread[];
  inlineThreads: readonly RemoteCommentThread[];
  drafts: readonly ReviewComment[];
  hideResolved: boolean;
  /** Bring the diff to the front — jumping to a comment implies it. */
  onShowDiff: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const jumpRef = useRef<DiffJumpHandle | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  // General (Conversation) comments first, then per file the remote
  // threads and the agent's drafts interleaved by line.
  const allItems = useMemo(
    () => buildCommentRows(files, general, inlineThreads, drafts),
    [files, general, inlineThreads, drafts]
  );
  // Hiding resolved threads in the diff while still listing them in the
  // rail — and letting prev/next jump to one that is not rendered — was
  // the inconsistency here, so the filter happens once.
  const items = visibleComments(allItems, hideResolved);
  const navIndex = navIndexOf(items, focusId);

  const jumpToFile = useCallback(
    (path: string) => {
      setSelectedFile(path);
      onShowDiff();
      requestAnimationFrame(() => jumpRef.current?.jumpToFile(path));
    },
    [onShowDiff]
  );

  // Scroll to any comment or draft by id, falling back to its file.
  // Goes through the virtual list's imperative handle — the target row
  // may not be materialized as DOM yet.
  const jumpToId = useCallback(
    (id: string, file: string | null) => {
      setFocusId(id);
      onShowDiff();
      if (file) setSelectedFile(file);
      requestAnimationFrame(() => {
        const jump = jumpRef.current;
        if (jump?.jumpToId(id)) return;
        if (file && jump?.jumpToFile(file)) return;
        scrollRef.current?.scrollTo({ top: 0 });
      });
    },
    [onShowDiff]
  );

  const jumpToItem = useCallback(
    (item: CommentListItem) => {
      const row = items.find((r) => r.id === item.id);
      jumpToId(item.id, row?.file ?? null);
    },
    [items, jumpToId]
  );

  const step = useCallback(
    (delta: number) => {
      const target: CommentRow | null = stepComment(items, navIndex, delta);
      if (!target) return;
      jumpToId(target.id, target.file ?? null);
    },
    [items, navIndex, jumpToId]
  );

  return {
    scrollRef,
    jumpRef,
    items,
    navIndex,
    focusId,
    selectedFile,
    jumpToFile,
    jumpToId,
    jumpToItem,
    step,
  };
}
