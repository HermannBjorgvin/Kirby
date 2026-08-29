import { Text, Box } from 'ink';
import { useKeybindResolve } from '@kirby/app-core';

/** The one-line key legend under the file list. */
export function DiffFileListHints({
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
