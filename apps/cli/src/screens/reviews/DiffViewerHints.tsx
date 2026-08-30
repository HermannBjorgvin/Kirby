import { Text, Box } from 'ink';
import { useKeybindResolve } from '@kirby/app-core';

// Separate component to isolate context subscription from memo'd parent
export function DiffViewerHints({
  hasComments,
  hasSections,
}: {
  hasComments: boolean;
  hasSections: boolean;
}) {
  const kb = useKeybindResolve();
  const scrollKeys = kb.getHintKeys('diff-viewer.scroll-down');
  const halfPageKeys = kb.getHintKeys('diff-viewer.half-page-down');
  const topKeys = kb.getHintKeys('diff-viewer.go-top');
  const bottomKeys = kb.getHintKeys('diff-viewer.go-bottom');
  const nextFileKeys = kb.getHintKeys('diff-viewer.next-file');
  const prevFileKeys = kb.getHintKeys('diff-viewer.prev-file');
  const nextCommentKeys = kb.getHintKeys('diff-viewer.next-comment');
  const prevCommentKeys = kb.getHintKeys('diff-viewer.prev-comment');
  const nextSectionKeys = kb.getHintKeys('diff-viewer.next-section');
  const prevSectionKeys = kb.getHintKeys('diff-viewer.prev-section');
  const backKeys = kb.getHintKeys('diff-viewer.back');

  return (
    <Box marginTop={1}>
      <Text dimColor>
        <Text color="cyan">{scrollKeys}</Text> scroll ·{' '}
        <Text color="cyan">{halfPageKeys}</Text> half-page ·{' '}
        <Text color="cyan">
          {topKeys}/{bottomKeys}
        </Text>{' '}
        top/bottom ·{' '}
        <Text color="cyan">
          {nextFileKeys}/{prevFileKeys}
        </Text>{' '}
        next/prev file ·{' '}
        {hasComments && (
          <>
            <Text color="cyan">
              {nextCommentKeys}/{prevCommentKeys}
            </Text>{' '}
            comments ·{' '}
          </>
        )}
        {hasSections && (
          <>
            <Text color="cyan">
              {nextSectionKeys}/{prevSectionKeys}
            </Text>{' '}
            sections ·{' '}
          </>
        )}
        <Text color="cyan">{backKeys}</Text> back
      </Text>
    </Box>
  );
}
