import { Text, Box } from 'ink';
import { CARD_INDENT } from '../../components/CommentThread.js';

// Note composer shown while annotating a plan item (Shift+A). Rendered
// *in place of* the comment card so it occupies the same slot — the card
// is briefly obscured, which keeps the layout stable and works on small
// terminals. Mirrors the card's indent + width so it lines up 1:1.
export function PlanAnnotateInput({
  buffer,
  width,
}: {
  buffer: string;
  width: number;
}) {
  const box = (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      marginBottom={1}
      paddingX={1}
      width={width}
    >
      <Text wrap="truncate-end">
        <Text bold color="green">
          EDITING NOTE
        </Text>
        <Text dimColor>{' [enter] save · [esc] cancel'}</Text>
      </Text>
      <Text wrap="wrap">
        {buffer}
        <Text color="green">▍</Text>
      </Text>
    </Box>
  );
  return (
    <Box>
      <Box width={CARD_INDENT} flexShrink={0} />
      {box}
    </Box>
  );
}
