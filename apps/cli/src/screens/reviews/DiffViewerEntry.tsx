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
    return (
      <RemoteThreadEntry
        thread={line.thread}
        cardWidth={cardWidth}
        state={state}
      />
    );
  }
  return (
    <LocalCommentEntry
      comment={line.comment}
      cardWidth={cardWidth}
      state={state}
    />
  );
}

/** A reviewer's thread, or the note composer standing in its slot. */
function RemoteThreadEntry({
  thread,
  cardWidth,
  state,
}: {
  thread: Extract<AnnotatedLine, { type: 'thread-remote' }>['thread'];
  cardWidth: number;
  state: DiffEntryState;
}) {
  const pKey = planItemKey('remote', thread.id);
  if (state.annotatingPlanKey === pKey) {
    return (
      <PlanAnnotateInput
        buffer={state.annotationBuffer ?? ''}
        width={cardWidth}
        indent={CARD_INDENT}
      />
    );
  }
  return (
    <CommentThreadCard
      thread={thread}
      selected={state.selectedCommentId === thread.id}
      replyingToThreadId={state.replyingToThreadId}
      replyBuffer={state.replyBuffer}
      maxWidth={cardWidth}
      indent={CARD_INDENT}
      inPlan={state.inPlanKeys?.has(pKey) ?? false}
      planHint
    />
  );
}

/** The agent's own draft, with the same composer takeover. */
function LocalCommentEntry({
  comment,
  cardWidth,
  state,
}: {
  comment: Extract<AnnotatedLine, { type: 'thread-local' }>['comment'];
  cardWidth: number;
  state: DiffEntryState;
}) {
  const pKey = planItemKey('local', comment.id);
  if (state.annotatingPlanKey === pKey) {
    return (
      <PlanAnnotateInput
        buffer={state.annotationBuffer ?? ''}
        width={cardWidth}
        indent={CARD_INDENT}
      />
    );
  }
  const editing = state.editingCommentId === comment.id;
  return (
    <LocalCommentCard
      comment={comment}
      selected={state.selectedCommentId === comment.id}
      pendingDelete={state.pendingDeleteCommentId === comment.id}
      editing={editing}
      editBuffer={editing ? state.editBuffer : undefined}
      maxWidth={cardWidth}
      indent={CARD_INDENT}
      inPlan={state.inPlanKeys?.has(pKey) ?? false}
      planHint
    />
  );
}
