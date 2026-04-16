import { memo } from 'react';
import { Text, Box } from 'ink';

export const TerminalView = memo(function TerminalView({
  content,
}: {
  content: string;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Text wrap="truncate">{content}</Text>
    </Box>
  );
});
