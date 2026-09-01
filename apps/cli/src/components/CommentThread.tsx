import { memo, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import {
  estimateBodyRows,
  estimateCardRows,
  estimateReplyInputRows,
  type ReviewComment,
} from '@kirby/review-comments';
import { planItemKey } from '@kirby/core';
import {
  cardBorderColor,
  collapseBody,
  commentBodyView,
  localHeaderSpans,
  replyHeaderSpans,
  threadHeaderSpans,
  type HeaderSpan,
} from '../models/comment-card-model.js';

// Shared Ink-based renderings for remote threads AND local drafts.
//
// Consumers:
//   - GeneralCommentsPane (Shift+C)       → <CommentThreadCard>
//   - DiffFileList PR-comments footer     → <CommentThreadCard>
//   - DiffViewer inline (M2 unification)  → <CommentThreadCard> for
//     remote threads, <LocalCommentCard> for local drafts.
//
// Single component per kind everywhere — no more ANSI/Ink split.
//
// Which spans a header carries, what each is coloured, and how much of
// a draft body is shown all live in ./comment-card-model.ts; the
// components below only draw what it decides.

/**
 * One logical header line.
 *
 * Collapsed into a single <Text> with nested colour spans so Ink's
 * text-measure pipeline keeps every span on one row and truncates on
 * overflow. Sibling <Text> nodes in a row Box would each get a
 * flex-shrunk column allocation and wrap individually, producing a
 * 2-row mangled header ("kirby-test-run | er", " · 2h | ago",
 * "[r]eply | [v]reopen").
 */
function HeaderLine({ spans }: { spans: HeaderSpan[] }) {
  return (
    <Text wrap="truncate-end">
      {spans.map((span) => (
        <Text
          key={span.key}
          bold={span.bold}
          color={span.color}
          dimColor={span.dim}
        >
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

/**
 * A comment body: its Conventional Comments badge row, the prose, and
 * the agent signature.
 *
 * Badge and signature each render as exactly one truncating row, which
 * is what lets `estimateCardRows` add a flat 1 for each rather than
 * measuring them — see the note there.
 */
function CommentBodyText({ body }: { body: string }) {
  const view = commentBodyView(body);
  return (
    <>
      {view.badge.length > 0 && <HeaderLine spans={view.badge} />}
      <Text wrap="wrap">{view.body}</Text>
      {view.footer && (
        <Text wrap="truncate-end" dimColor>
          {view.footer}
        </Text>
      )}
    </>
  );
}

/**
 * Indent the card so it lines up with the diff gutter when requested.
 * Rendered as a sibling <Box> that consumes `indent` columns; keeps the
 * card's own padding/border math simple.
 */
function CardShell({
  indent,
  children,
}: {
  indent: number | undefined;
  children: ReactNode;
}) {
  if (indent && indent > 0) {
    return (
      <Box>
        <Box width={indent} flexShrink={0} />
        {children}
      </Box>
    );
  }
  return children;
}

// ── Full-size card ───────────────────────────────────────────────────

interface CommentThreadCardProps {
  thread: RemoteCommentThread;
  /** Highlight the border + show action hints when true */
  selected?: boolean;
  /** Reply-input overlay for the Shift+C pane */
  replyingToThreadId?: string | null;
  replyBuffer?: string;
  /**
   * Cap the card's visible width. When set, the card renders inside a
   * fixed-width Box so it doesn't stretch to the full pane width —
   * matches the ANSI predecessor that capped at ~80 cols so threads sit
   * next to the diff code rather than dominating the viewport.
   * Undefined = flex (pane fills the card, used by GeneralCommentsPane).
   */
  maxWidth?: number;
  /**
   * Left indent (in cells). Matches the diff renderer's gutter so the
   * card starts where the code content does. Default 0.
   */
  indent?: number;
  /** Whether the comment is queued in the PR plan (drives the hint). */
  inPlan?: boolean;
  /**
   * Show the a/A plan-action hint when selected. Only consumers whose
   * input context actually handles the plan actions (diff viewer,
   * diff-file-list footer) should set this — the Shift+C pane must not.
   */
  planHint?: boolean;
}

// Constants that mirror the previous ANSI renderer's visual language —
// kept so card width + indent line up with diff row content.
export const CARD_MAX_WIDTH = 80;
export const CARD_INDENT = 13;

export const CommentThreadCard = memo(function CommentThreadCard({
  thread,
  selected = false,
  replyingToThreadId,
  replyBuffer,
  maxWidth,
  indent,
  inPlan = false,
  planHint = false,
}: CommentThreadCardProps) {
  const rootComment = thread.comments[0];
  if (!rootComment) return null;

  const isReplying = replyingToThreadId === thread.id;

  return (
    <CardShell indent={indent}>
      <Box
        flexDirection="column"
        // Always frame the card — a gray border when unselected keeps
        // the shape consistent across the Shift+C pane (where one card
        // is always selected) and the file-list footer (where none
        // is). See cardBorderColor for how selection and plan
        // membership compete for the tint.
        borderStyle="round"
        borderColor={cardBorderColor({
          selected,
          inPlan,
          selectedColor: 'cyan',
        })}
        marginBottom={1}
        paddingX={1}
        {...(maxWidth !== undefined ? { width: maxWidth } : {})}
      >
        <HeaderLine
          spans={threadHeaderSpans(thread, {
            selected,
            replying: isReplying,
            planHint,
            inPlan,
          })}
        />
        <CommentBodyText body={rootComment.body} />
        {thread.comments.length > 1 && (
          <Box flexDirection="column" marginTop={1}>
            {thread.comments.slice(1).map((reply) => (
              <Box key={reply.id} flexDirection="column" marginLeft={2}>
                <HeaderLine spans={replyHeaderSpans(reply)} />
                <CommentBodyText body={reply.body} />
              </Box>
            ))}
          </Box>
        )}
        {isReplying && (
          <Box
            flexDirection="column"
            marginTop={1}
            marginLeft={2}
            borderStyle="round"
            borderColor="cyan"
            paddingX={1}
          >
            <Text>{replyBuffer ?? ''}▍</Text>
          </Box>
        )}
      </Box>
    </CardShell>
  );
});

// ── Local comment card (draft / unposted) ───────────────────────────

interface LocalCommentCardProps {
  comment: ReviewComment;
  /** Highlight + expand body when selected. */
  selected?: boolean;
  /** When true, show the delete-confirm prompt header. */
  pendingDelete?: boolean;
  /** When true, render `editBuffer` as the body with a cursor. */
  editing?: boolean;
  editBuffer?: string;
  /** See CommentThreadCard.maxWidth. */
  maxWidth?: number;
  /** See CommentThreadCard.indent. */
  indent?: number;
  /** Whether the comment is queued in the PR plan (drives the hint). */
  inPlan?: boolean;
  /** See CommentThreadCard.planHint. */
  planHint?: boolean;
}

/**
 * A draft's body: its badge row, its prose (capped unless the card is
 * selected), and its signature.
 *
 * The badge and the signature are properties of the comment, not of
 * the collapsed view, so they stay on a card whose prose is capped —
 * which is also how `estimateLocalCardRows` counts them.
 */
function LocalCommentBody({
  body,
  expanded,
}: {
  body: string;
  expanded: boolean;
}) {
  const collapsed = collapseBody(body, expanded);
  const view = commentBodyView(body);
  return (
    <>
      {view.badge.length > 0 && <HeaderLine spans={view.badge} />}
      {/* One Text, not one per line: the lines are a positional split
          of a single string, so there is no identity to key them by,
          and Ink wraps an embedded newline the same way it wraps a
          sibling row. */}
      <Text wrap="wrap">{collapsed.lines.join('\n')}</Text>
      {collapsed.hiddenCount > 0 && (
        <Text dimColor>… {collapsed.hiddenCount} more lines</Text>
      )}
      {view.footer && (
        <Text wrap="truncate-end" dimColor>
          {view.footer}
        </Text>
      )}
    </>
  );
}

export const LocalCommentCard = memo(function LocalCommentCard({
  comment,
  selected = false,
  pendingDelete = false,
  editing = false,
  editBuffer,
  maxWidth,
  indent,
  inPlan = false,
  planHint = false,
}: LocalCommentCardProps) {
  return (
    <CardShell indent={indent}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={cardBorderColor({
          selected,
          inPlan,
          selectedColor: 'yellow',
        })}
        marginBottom={1}
        paddingX={1}
        {...(maxWidth !== undefined ? { width: maxWidth } : {})}
      >
        <HeaderLine
          spans={localHeaderSpans(comment, {
            selected,
            pendingDelete,
            editing,
            planHint,
            inPlan,
          })}
        />
        {editing ? (
          <Text>
            {editBuffer ?? ''}
            <Text color="cyan">▍</Text>
          </Text>
        ) : (
          <LocalCommentBody body={comment.body} expanded={selected} />
        )}
      </Box>
    </CardShell>
  );
});

/**
 * Shared layout decision for the diff-file-list PR-comments footer.
 * Returns every thread (all stay j/k-selectable — the footer scrolls
 * cards into view rather than capping the list) plus per-card row
 * estimates so DiffFileList can budget its footer window.
 *
 * `contentWidth` is the card's interior text width (card width minus
 * border + padding). Without it, estimates cap bodies at 4 lines and
 * wrapped long bodies are badly undercounted — always pass it from
 * render paths.
 */
/** Live compose state that changes a card's rendered height. */
export interface FooterComposeState {
  replyingToThreadId?: string | null;
  replyBuffer?: string;
  annotatingPlanKey?: string | null;
  annotationBuffer?: string;
}

export function planCommentFooter(
  threads: RemoteCommentThread[],
  contentWidth?: number,
  compose?: FooterComposeState
): {
  shown: RemoteCommentThread[];
  rows: number;
  spans: number[];
} {
  if (threads.length === 0) return { shown: [], rows: 0, spans: [] };
  const spans = threads.map((thread) => {
    // The Shift+A note composer REPLACES the card in the file-list
    // render. It keeps the replaced card's footprint (the renderer
    // pins its height to the span) so entering/leaving annotate mode
    // never shifts the layout — the span only grows past the card
    // when the note wraps taller than it: border (2) + header row +
    // wrapped buffer (with cursor cell) + marginBottom.
    if (compose?.annotatingPlanKey === planItemKey('remote', thread.id)) {
      const composerRows =
        2 +
        1 +
        estimateBodyRows(`${compose.annotationBuffer ?? ''}▍`, contentWidth) +
        1;
      return Math.max(estimateCardRows(thread, contentWidth), composerRows);
    }
    return (
      estimateCardRows(thread, contentWidth) +
      (thread.id === compose?.replyingToThreadId
        ? estimateReplyInputRows(compose.replyBuffer ?? '', contentWidth)
        : 0)
    );
  });
  // +1 for the "PR Comments (N)" heading
  const rows = 1 + spans.reduce((sum, s) => sum + s, 0);
  return { shown: threads, rows, spans };
}
