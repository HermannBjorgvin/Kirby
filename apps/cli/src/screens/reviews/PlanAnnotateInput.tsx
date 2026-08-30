import { Text, Box } from 'ink';

// Note composer shown while annotating a plan item (Shift+A). Rendered
// *in place of* the comment card so it occupies the same slot — the card
// is briefly obscured, which keeps the layout stable and works on small
// terminals. Mirrors the card's indent + width so it lines up 1:1.
export function PlanAnnotateInput({
  buffer,
  width,
  height,
  indent,
}: {
  buffer: string;
  width: number;
  /**
   * Fixed height, for the virtualised file list: there the composer has
   * to occupy exactly the rows the card it replaces was measured at, or
   * entering and leaving annotate mode shifts everything below it. The
   * unvirtualised viewer lets it size to its content.
   */
  height?: number;
  /** Left spacer matching the card's own indent, where cards have one. */
  indent?: number;
}) {
  const box = (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      marginBottom={1}
      paddingX={1}
      width={width}
      height={height}
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
  if (!indent) return box;
  return (
    <Box>
      <Box width={indent} flexShrink={0} />
      {box}
    </Box>
  );
}
