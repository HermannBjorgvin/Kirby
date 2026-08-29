import { memo, useMemo } from 'react';
import { Text, Box } from 'ink';
import type { ReviewComment } from '@kirby/core';
import type { DiffFile } from '@kirby/diff';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { partitionFiles } from '@kirby/diff';
import { VirtualViewport } from '../../components/VirtualViewport.js';
import { computeDiffListLayout } from './diff-list-layout.js';
import { DirRow, FileRow } from './DiffFileRow.js';
import { DiffFileListHints } from './DiffFileListHints.js';
import { DiffListCommentItem } from './DiffListCommentItem.js';

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

            return (
              <DiffListCommentItem
                thread={item.thread}
                withHeading={item.withHeading}
                span={item.span}
                commentIndex={item.commentIndex}
                threadCount={generalThreads.length}
                cardWidth={cardWidth}
                selectedCommentIndex={selectedCommentIndex}
                replyingToThreadId={replyingToThreadId}
                replyBuffer={replyBuffer}
                inPlanKeys={inPlanKeys}
                annotatingPlanKey={annotatingPlanKey}
                annotationBuffer={annotationBuffer}
              />
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
