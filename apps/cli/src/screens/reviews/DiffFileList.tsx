import { memo, useMemo } from 'react';
import { Text, Box } from 'ink';
import type { ReviewComment } from '../../types.js';
import type { DiffFile } from '@kirby/diff';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { partitionFiles } from '@kirby/diff';
import { truncate } from '../../utils/truncate.js';
import {
  computeScrollWindow,
  computeSpanScrollWindow,
} from '../../utils/scroll-window.js';
import { useKeybindResolve } from '../../context/KeybindContext.js';
import {
  CommentThreadCard,
  planCommentFooter,
  CARD_MAX_WIDTH,
} from '../../components/CommentThread.js';
import { planItemKey } from '../../plan/plan-types.js';

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

// Tree row — either a directory header or a file. Directory headers
// render dim with no stats; their depth indents nested paths. `fileRowIndex`
// is the ordinal within the file-only sequence, used to map the outer
// `selectedIndex` (which still counts files, not rows) to a row.
type TreeRow =
  | { kind: 'dir'; name: string; depth: number }
  | { kind: 'file'; file: DiffFile; depth: number; fileRowIndex: number };

function buildFileTree(files: DiffFile[]): TreeRow[] {
  const rows: TreeRow[] = [];
  const emittedDirs = new Set<string>();
  files.forEach((file, fileRowIndex) => {
    const parts = file.filename.split('/');
    const dirs = parts.slice(0, -1);
    // Emit each missing ancestor directory once, deepest-last.
    let prefix = '';
    dirs.forEach((segment, depth) => {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      if (!emittedDirs.has(prefix)) {
        emittedDirs.add(prefix);
        rows.push({ kind: 'dir', name: segment, depth });
      }
    });
    rows.push({
      kind: 'file',
      file,
      depth: dirs.length,
      fileRowIndex,
    });
  });
  return rows;
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
      <Text dimColor>
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
  /** Index into the rendered PR-comments footer that is currently
   *  highlighted (undefined = selection is on a file row instead). */
  selectedCommentIndex?: number;
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

  // Tree mode renders the same displayFiles just grouped under dir
  // headers. Files must already be in the caller's desired order
  // (container sorts before handing in) so the selected-file index
  // matches both the input handler and the visible row position.
  const treeRows = useMemo(
    () => (treeMode ? buildFileTree(displayFiles) : null),
    [treeMode, displayFiles]
  );

  const maxWidth = Math.max(20, paneCols - 2);
  // Footer cards are capped like the diff viewer's so long bodies wrap
  // at a readable width AND the row estimates (which are width-based)
  // match what actually renders. Interior text width = card width
  // minus border (2) + paddingX (2).
  const cardWidth = Math.min(CARD_MAX_WIDTH, maxWidth);
  const cardContentWidth = Math.max(1, cardWidth - 4);

  // PR-comments footer: every thread stays j/k-selectable; the footer
  // renders a scrollable window of cards around the selection instead
  // of drawing all of them (which used to Yoga-squeeze the cards into
  // border soup once they exceeded the pane).
  const generalThreads = useMemo(
    () => generalComments ?? [],
    [generalComments]
  );
  const { shown: shownGeneral, spans: generalSpans } = useMemo(
    () =>
      planCommentFooter(generalThreads, cardContentWidth, replyingToThreadId),
    [generalThreads, cardContentWidth, replyingToThreadId]
  );

  // In tree mode, total visual rows = files + directories. Otherwise
  // it's just files. Scroll window is computed against the selected
  // row's position in the visual stream so dir headers above scroll
  // out naturally with the file.
  const totalVisualRows = treeRows ? treeRows.length : displayFiles.length;

  // ── Row budget ──────────────────────────────────────────────────
  // Chrome: title + divider + hints (marginTop + row) + optional
  // skipped note. The remainder is split between the file list and
  // the comments footer: the list keeps up to half the pane (but no
  // more than it needs), the footer gets the rest capped by its own
  // need. footerRows includes the footer's marginTop + heading.
  const skippedNoteRows = skipped.length > 0 ? 1 : 0;
  const available = Math.max(1, paneRows - 4 - skippedNoteRows);
  const footerNeed =
    shownGeneral.length > 0
      ? 2 + generalSpans.reduce((sum, s) => sum + s, 0)
      : 0;
  // Even an empty list draws one row ("(no files)").
  const fileNeed = Math.max(1, totalVisualRows);
  const fileReserved = Math.min(fileNeed, Math.ceil(available / 2));
  const footerRows =
    footerNeed > 0
      ? Math.min(footerNeed, Math.max(0, available - fileReserved))
      : 0;
  const maxVisible = Math.max(1, available - footerRows);
  const selectedVisualIndex = treeRows
    ? (() => {
        const hit = treeRows.findIndex(
          (r) => r.kind === 'file' && r.fileRowIndex === selectedIndex
        );
        return hit === -1 ? 0 : hit;
      })()
    : selectedIndex;
  const needsIndicators = totalVisualRows > maxVisible;
  const indicatorRows = needsIndicators ? 2 : 0;
  const listRows = maxVisible - indicatorRows;

  const { windowStart, aboveCount, belowCount } = computeScrollWindow({
    totalItems: totalVisualRows,
    selectedIndex: selectedVisualIndex,
    maxVisible: listRows,
  });
  const visibleFiles = !treeRows
    ? displayFiles.slice(windowStart, windowStart + Math.max(1, listRows))
    : null;
  const visibleRows = treeRows
    ? treeRows.slice(windowStart, windowStart + Math.max(1, listRows))
    : null;

  // Card-granularity scroll window over the footer, anchored on the
  // selected card (top of the list when selection is on a file row).
  const footerWindow = computeSpanScrollWindow({
    spans: generalSpans,
    selectedIndex: selectedCommentIndex ?? 0,
    budgetRows: Math.max(0, footerRows - 2),
  });
  const footerIndicatorRows =
    (footerWindow.aboveCount > 0 ? 1 : 0) +
    (footerWindow.belowCount > 0 ? 1 : 0);
  // Fixed clip box for the cards: even when a card's row estimate is
  // off by a little, the overflow is cut here instead of letting Yoga
  // squeeze every card in the column.
  const footerCardBoxRows = Math.max(1, footerRows - 2 - footerIndicatorRows);

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

      {displayFiles.length > 0 && (
        <Box flexDirection="column">
          {aboveCount > 0 && <Text dimColor>↑ {aboveCount} more</Text>}
          {visibleFiles &&
            visibleFiles.map((f, i) => {
              const realIndex = windowStart + i;
              const isSelected = realIndex === selectedIndex;
              return (
                <FileRow
                  key={f.filename}
                  file={f}
                  selected={isSelected}
                  maxWidth={maxWidth}
                  commentCount={commentCounts.get(f.filename) ?? 0}
                  hasAnyComments={hasAnyComments}
                />
              );
            })}
          {visibleRows &&
            visibleRows.map((row, i) =>
              row.kind === 'dir' ? (
                <DirRow
                  key={`d:${windowStart + i}:${row.name}`}
                  name={row.name}
                  depth={row.depth}
                />
              ) : (
                <FileRow
                  key={row.file.filename}
                  file={row.file}
                  selected={row.fileRowIndex === selectedIndex}
                  maxWidth={maxWidth}
                  commentCount={commentCounts.get(row.file.filename) ?? 0}
                  hasAnyComments={hasAnyComments}
                  depth={row.depth}
                />
              )
            )}
          {belowCount > 0 && <Text dimColor>↓ {belowCount} more</Text>}
        </Box>
      )}

      {skipped.length > 0 && !showSkipped && (
        <Text dimColor>{skipped.length} skipped (binary/lock/generated)</Text>
      )}
      {skipped.length > 0 && showSkipped && <Text dimColor>showing all</Text>}

      {shownGeneral.length > 0 && footerRows >= 2 && (
        <Box flexDirection="column" marginTop={1} flexShrink={0}>
          <Text bold color="blue">
            PR Comments ({generalThreads.length})
          </Text>
          {footerWindow.aboveCount > 0 && (
            <Text dimColor>↑ {footerWindow.aboveCount} more</Text>
          )}
          <Box
            flexDirection="column"
            height={footerCardBoxRows}
            overflow="hidden"
            flexShrink={0}
          >
            {shownGeneral
              .slice(footerWindow.start, footerWindow.end)
              .map((thread, i) => {
                const idx = footerWindow.start + i;
                const pKey = planItemKey('remote', thread.id);
                // While annotating, the composer takes the card's slot.
                if (annotatingPlanKey === pKey) {
                  return (
                    <Box key={thread.id} flexShrink={0}>
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
                    </Box>
                  );
                }
                return (
                  <Box key={thread.id} flexShrink={0}>
                    <CommentThreadCard
                      thread={thread}
                      selected={
                        selectedCommentIndex !== undefined &&
                        selectedCommentIndex === idx
                      }
                      replyingToThreadId={replyingToThreadId}
                      replyBuffer={replyBuffer}
                      maxWidth={cardWidth}
                      inPlan={inPlanKeys?.has(pKey) ?? false}
                      planHint
                    />
                  </Box>
                );
              })}
          </Box>
          {footerWindow.belowCount > 0 && (
            <Text dimColor>↓ {footerWindow.belowCount} more</Text>
          )}
        </Box>
      )}

      <DiffFileListHints
        hasComments={generalThreads.length > 0}
        commentSelected={selectedCommentIndex !== undefined}
      />
    </Box>
  );
});
