import { Text } from 'ink';
import type { AnnotatedLine } from '@kirby/review-comments';
import { planItemKey } from '@kirby/core';
import {
  CommentThreadCard,
  LocalCommentCard,
  CARD_INDENT,
} from '../../components/CommentThread.js';
import { DiffRow } from './DiffRow.js';
import { PlanAnnotateInput } from './PlanAnnotateInput.js';

/** Everything a comment card needs to know about what the user is
 *  currently doing to it. */
export interface DiffEntryState {
  selectedCommentId?: string | null;
  pendingDeleteCommentId?: string | null;
  editingCommentId?: string | null;
  editBuffer?: string;
  replyingToThreadId?: string | null;
  replyBuffer?: string;
  /** Keys (`${kind}:${id}`) of comments queued in the plan. */
  inPlanKeys?: Map<string, boolean>;
  /** Plan key currently being annotated (Shift+A composer target). */
  annotatingPlanKey?: string | null;
  annotationBuffer?: string;
}

/**
 * One entry of the annotated stream: a diff row, a hunk separator, or a
 * comment card — remote thread or local draft, either of which the plan
 * note composer stands in for while it is being annotated.
 */
export function DiffViewerEntry({
  line,
  language,
  paneCols,
  cardWidth,
  state,
}: {
  line: AnnotatedLine;
  language: string | undefined;
  paneCols: number;
  cardWidth: number;
  state: DiffEntryState;
}) {
  const {
    selectedCommentId,
    pendingDeleteCommentId,
    editingCommentId,
    editBuffer,
    replyingToThreadId,
    replyBuffer,
    inPlanKeys,
    annotatingPlanKey,
    annotationBuffer,
  } = state;

  if (line.type === 'diff') {
    return (
      <DiffRow
        line={line.line}
        highlighted={line.highlighted}
        language={language}
        paneCols={paneCols}
      />
    );
  }
  if (line.type === 'separator') {
    return <Text wrap="truncate">{line.rendered}</Text>;
  }
  if (line.type === 'thread-remote') {
    const pKey = planItemKey('remote', line.thread.id);
    // While annotating this item, the composer takes the card's slot.
    if (annotatingPlanKey === pKey) {
      return (
        <PlanAnnotateInput
          buffer={annotationBuffer ?? ''}
          width={cardWidth}
          indent={CARD_INDENT}
        />
      );
    }
    return (
      <CommentThreadCard
        thread={line.thread}
        selected={selectedCommentId === line.thread.id}
        replyingToThreadId={replyingToThreadId}
        replyBuffer={replyBuffer}
        maxWidth={cardWidth}
        indent={CARD_INDENT}
        inPlan={inPlanKeys?.has(pKey) ?? false}
        planHint
      />
    );
  }
  const pKey = planItemKey('local', line.comment.id);
  if (annotatingPlanKey === pKey) {
    return (
      <PlanAnnotateInput
        buffer={annotationBuffer ?? ''}
        width={cardWidth}
        indent={CARD_INDENT}
      />
    );
  }
  return (
    <LocalCommentCard
      comment={line.comment}
      selected={selectedCommentId === line.comment.id}
      pendingDelete={pendingDeleteCommentId === line.comment.id}
      editing={editingCommentId === line.comment.id}
      editBuffer={editingCommentId === line.comment.id ? editBuffer : undefined}
      maxWidth={cardWidth}
      indent={CARD_INDENT}
      inPlan={inPlanKeys?.has(pKey) ?? false}
      planHint
    />
  );
}
