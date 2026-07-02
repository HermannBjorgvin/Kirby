import { memo, useMemo } from 'react';
import { Text, Box } from 'ink';
import type { ReviewComment } from '../../types.js';
import type { DiffFile } from '@kirby/diff';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { partitionFiles } from '@kirby/diff';
import { truncate } from '../../utils/truncate.js';
import { useKeybindResolve } from '../../context/KeybindContext.js';
import { CommentThreadCard } from '../../components/CommentThread.js';
import { VirtualViewport } from '../../components/VirtualViewport.js';
import { planItemKey } from '../../plan/plan-types.js';
import { computeDiffListLayout } from './diff-list-layout.js';

function statusBadge(status: DiffFile['status']): {
  char: string;
  color: string;
} {
  switch (status) {
    case 'added':
      return { char: 'A', color: 'green' };
    case 'removed':
      return { char: 'D', color: 'red' };
    case 'renamed':
      return { char: 'R', color: 'cyan' };
    case 'copied':
      return { char: 'C', color: 'cyan' };
    case 'changed':
      return { char: 'C', color: 'yellow' };
    default:
      return { char: 'M', color: 'yellow' };
  }
}

function FileRow({
  file,
  selected,
  maxWidth,
  commentCount,
  hasAnyComments,
  depth = 0,
}: {
  file: DiffFile;
  selected: boolean;
  maxWidth: number;
  commentCount: number;
  hasAnyComments: boolean;
  depth?: number;
}) {
  const badge = statusBadge(file.status);
  const prefix = selected ? '› ' : '  ';
  const stats = ` +${file.additions} -${file.deletions}`;
  const indent = '  '.repeat(depth);

  // Comment count badge on LEFT side: "N💬 " or padding for alignment
  // Widest realistic badge: "99💬 " = 5 chars (count + emoji + space)
  const badgeWidth = hasAnyComments ? 4 : 0;
  const commentBadgeStr = commentCount > 0 ? `${commentCount}` : '';
  const commentPad = hasAnyComments
    ? ' '.repeat(Math.max(0, badgeWidth - commentBadgeStr.length))
    : '';

  // In tree mode we show only the basename; callers in flat mode pass
  // depth=0 so the full path still renders.
  const displayName =
    depth > 0
      ? file.filename.slice(file.filename.lastIndexOf('/') + 1)
      : file.filename;
  const displayPrev =
    depth > 0 && file.previousFilename
      ? file.previousFilename.slice(file.previousFilename.lastIndexOf('/') + 1)
      : file.previousFilename;

  const nameWidth = Math.max(
    10,
    maxWidth - prefix.length - indent.length - 2 - badgeWidth - stats.length - 1
  );
  const name = displayPrev
    ? `${truncate(displayPrev, Math.floor(nameWidth / 2))} → ${truncate(
        displayName,
        Math.ceil(nameWidth / 2)
      )}`
    : truncate(displayName, nameWidth);

  return (
    <Text>
      <Text color={selected ? 'cyan' : undefined}>{prefix}</Text>
      <Text>{indent}</Text>
      <Text color={badge.color}>{badge.char}</Text>{' '}
      {commentCount > 0 && <Text color="yellow">{commentBadgeStr} </Text>}
      {commentCount === 0 && hasAnyComments && <Text>{commentPad}</Text>}
      <Text bold={selected}>{name}</Text>
      <Text color="green"> +{file.additions}</Text>
      <Text color="red"> -{file.deletions}</Text>
    </Text>
  );
}

function DirRow({ name, depth }: { name: string; depth: number }) {
  const indent = '  '.repeat(depth);
  return (
    <Text dimColor>
      {'  '}
      {indent}
      {name}/
    </Text>
  );
}

function DiffFileListHints({
  hasComments,
  commentSelected,
}: {
  hasComments: boolean;
  commentSelected: boolean;
}) {
  const kb = useKeybindResolve();
  const navKeys = kb.getNavKeys('diff-file-list');
  const openKeys = kb.getHintKeys('diff-file-list.open');
  const toggleKeys = kb.getHintKeys('diff-file-list.toggle-skipped');
  const backKeys = kb.getHintKeys('diff-file-list.back');
  const nextCommentKeys = kb.getHintKeys('diff-file-list.next-comment');
  const prevCommentKeys = kb.getHintKeys('diff-file-list.prev-comment');
  const nextSectionKeys = kb.getHintKeys('diff-file-list.next-section');
  const prevSectionKeys = kb.getHintKeys('diff-file-list.prev-section');
  const replyKeys = kb.getHintKeys('diff-file-list.reply-to-thread');
  const resolveKeys = kb.getHintKeys('diff-file-list.toggle-thread-resolved');
  return (
    <Box marginTop={1}>
      {/* One budgeted row — truncate on narrow panes rather than wrap
          (a wrapped hint line would push the pane past paneRows). */}
      <Text dimColor wrap="truncate-end">
        <Text color="cyan">{navKeys}</Text> navigate ·{' '}
        {commentSelected ? (
          <>
            <Text color="cyan">{replyKeys}</Text> reply ·{' '}
            <Text color="cyan">{resolveKeys}</Text> resolve ·{' '}
          </>
        ) : (
          <>
            <Text color="cyan">{openKeys}</Text> view diff ·{' '}
          </>
        )}
        {hasComments && (
          <>
            <Text color="cyan">
              {nextCommentKeys}/{prevCommentKeys}
            </Text>{' '}
            comments ·{' '}
            <Text color="cyan">
              {nextSectionKeys}/{prevSectionKeys}
            </Text>{' '}
            sections ·{' '}
          </>
        )}
        <Text color="cyan">{toggleKeys}</Text> toggle skipped ·{' '}
        <Text color="cyan">{backKeys}</Text> back
      </Text>
    </Box>
  );
}

export const DiffFileList = memo(function DiffFileList({
  files,
  selectedIndex,
  paneRows,
  paneCols,
  loading,
  error,
  showSkipped,
  comments,
  treeMode = false,
  generalComments,
  selectedCommentIndex,
  scrollRow = 0,
  replyingToThreadId,
  replyBuffer,
  inPlanKeys,
  annotatingPlanKey,
  annotationBuffer,
}: {
  files: DiffFile[];
  selectedIndex: number;
  paneRows: number;
  paneCols: number;
  loading: boolean;
  error: string | null;
  showSkipped: boolean;
  comments?: ReviewComment[];
  treeMode?: boolean;
  generalComments?: RemoteCommentThread[];
  /** Index of the highlighted comment (undefined = selection is on a
   *  file row instead). */
  selectedCommentIndex?: number;
  /** Top row of the unified list viewport (pane state; the input
   *  handler steps it row-wise so tall cards scroll before selection
   *  moves on). */
  scrollRow?: number;
  replyingToThreadId?: string | null;
  replyBuffer?: string;
  /** Keys (`${kind}:${id}`) of comments queued in the plan. */
  inPlanKeys?: Map<string, boolean>;
  /** Plan key currently being annotated (Shift+A composer target). */
  annotatingPlanKey?: string | null;
  annotationBuffer?: string;
}) {
  const displayFiles = useMemo(() => {
    const { normal, skipped } = partitionFiles(files);
    return showSkipped ? [...normal, ...skipped] : normal;
  }, [files, showSkipped]);
  const { skipped } = partitionFiles(files);

  const commentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!comments) return counts;
    for (const c of comments) {
      counts.set(c.file, (counts.get(c.file) ?? 0) + 1);
    }
    return counts;
  }, [comments]);

  const hasAnyComments = commentCounts.size > 0;

  const generalThreads = useMemo(
    () => generalComments ?? [],
    [generalComments]
  );

  // One unified virtual viewport: file rows and comment cards are a
  // single scrollable stream (selection order = files, then comments).
  // Shared with the input handler so scroll math matches the render —
  // see diff-list-layout.ts.
  const layout = useMemo(
    () =>
      computeDiffListLayout({
        paneRows,
        paneCols,
        displayFiles,
        treeMode,
        skippedCount: skipped.length,
        threads: generalThreads,
        compose: {
          replyingToThreadId,
          replyBuffer,
          annotatingPlanKey,
          annotationBuffer,
        },
      }),
    [
      paneRows,
      paneCols,
      displayFiles,
      treeMode,
      skipped.length,
      generalThreads,
      replyingToThreadId,
      replyBuffer,
      annotatingPlanKey,
      annotationBuffer,
    ]
  );
  const { maxWidth, cardWidth, items } = layout;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Text bold color="blue">
        Files Changed ({files.length})
      </Text>
      <Text dimColor>{'─'.repeat(Math.min(40, maxWidth))}</Text>

      {error && <Text color="red">Error: {error}</Text>}

      {files.length > 500 && (
        <Text color="yellow">Large PR: {files.length} files</Text>
      )}

      {!loading && !error && displayFiles.length === 0 && (
        <Text dimColor>(no files)</Text>
      )}

      {items.length > 0 && (
        <VirtualViewport
          spans={layout.spans}
          offset={scrollRow}
          budgetRows={layout.budgetRows}
          renderItem={(idx) => {
            const item = items[idx];
            if (!item) return null;

            if (item.kind === 'file') {
              return (
                <Box flexDirection="column">
                  {item.dirs.map((dir, d) => (
                    <DirRow
                      key={`d:${d}:${dir.name}`}
                      name={dir.name}
                      depth={dir.depth}
                    />
                  ))}
                  <FileRow
                    file={item.file}
                    selected={idx === selectedIndex}
                    maxWidth={maxWidth}
                    commentCount={commentCounts.get(item.file.filename) ?? 0}
                    hasAnyComments={hasAnyComments}
                    depth={item.depth}
                  />
                </Box>
              );
            }

            const { thread } = item;
            const pKey = planItemKey('remote', thread.id);
            const heading = item.withHeading && (
              <Box marginTop={1} flexShrink={0}>
                <Text bold color="blue">
                  PR Comments ({generalThreads.length})
                </Text>
              </Box>
            );
            // While annotating, the composer takes the card's slot.
            const card =
              annotatingPlanKey === pKey ? (
                <Box
                  flexDirection="column"
                  borderStyle="round"
                  borderColor="green"
                  marginBottom={1}
                  paddingX={1}
                  width={cardWidth}
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
                    selectedCommentIndex === item.commentIndex
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
          }}
        />
      )}

      {skipped.length > 0 && !showSkipped && (
        <Text dimColor>{skipped.length} skipped (binary/lock/generated)</Text>
      )}
      {skipped.length > 0 && showSkipped && <Text dimColor>showing all</Text>}

      <DiffFileListHints
        hasComments={generalThreads.length > 0}
        commentSelected={selectedCommentIndex !== undefined}
      />
    </Box>
  );
});
