import { Text, Box } from 'ink';
import { planItemKey } from '@kirby/core';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { CommentThreadCard } from '../../components/CommentThread.js';

/**
 * A general PR comment in the unified file/comment stream: the "PR
 * Comments" heading when this is the first of them, then either the
 * thread card or, while the user is annotating it for the plan, the
 * note composer standing in its place.
 */
export function DiffListCommentItem({
  thread,
  withHeading,
  span,
  commentIndex,
  threadCount,
  cardWidth,
  selectedCommentIndex,
  replyingToThreadId,
  replyBuffer,
  inPlanKeys,
  annotatingPlanKey,
  annotationBuffer,
}: {
  thread: RemoteCommentThread;
  withHeading: boolean;
  /** Rows this item occupies in the viewport, heading included. */
  span: number;
  commentIndex: number;
  threadCount: number;
  cardWidth: number;
  selectedCommentIndex?: number;
  replyingToThreadId?: string | null;
  replyBuffer?: string;
  inPlanKeys?: Map<string, boolean>;
  annotatingPlanKey?: string | null;
  annotationBuffer?: string;
}) {
  const pKey = planItemKey('remote', thread.id);
  const heading = withHeading && (
    <Box marginTop={1} flexShrink={0}>
      <Text bold color="blue">
        PR Comments ({threadCount})
      </Text>
    </Box>
  );
  // While annotating, the composer takes the card's slot at
  // the card's exact footprint (span minus the heading rows
  // it may carry, minus its own marginBottom) so entering
  // and leaving annotate mode never shifts the layout.
  const composerHeight = span - (withHeading ? 2 : 0) - 1;
  const card =
    annotatingPlanKey === pKey ? (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="green"
        marginBottom={1}
        paddingX={1}
        width={cardWidth}
        height={composerHeight}
      >
        <Text wrap="truncate-end">
          <Text bold color="green">
            EDITING NOTE
          </Text>
          <Text dimColor>{' [enter] save · [esc] cancel'}</Text>
        </Text>
        <Text wrap="wrap">
          {annotationBuffer ?? ''}
          <Text color="green">▍</Text>
        </Text>
      </Box>
    ) : (
      <CommentThreadCard
        thread={thread}
        selected={
          selectedCommentIndex !== undefined &&
          selectedCommentIndex === commentIndex
        }
        replyingToThreadId={replyingToThreadId}
        replyBuffer={replyBuffer}
        maxWidth={cardWidth}
        inPlan={inPlanKeys?.has(pKey) ?? false}
        planHint
      />
    );
  return (
    <Box flexDirection="column">
      {heading}
      {card}
    </Box>
  );
}
