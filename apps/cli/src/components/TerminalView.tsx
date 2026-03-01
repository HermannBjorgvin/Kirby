import { memo } from 'react';
import { Text, Box } from 'ink';

export const TerminalView = memo(function TerminalView({
  content,
  focused,
}: {
  content: string;
  focused: boolean;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Text bold color={focused ? 'green' : 'gray'}>
        🤖 Agent
      </Text>
      <Text dimColor>{'─'.repeat(40)}</Text>
      <Text wrap="truncate">{content}</Text>
    </Box>
  );
});
