import { Text, Box, useInput } from 'ink';
import type { VcsProvider } from '@kirby/vcs-core';

interface DoneStepProps {
  provider: VcsProvider;
  isActive: boolean;
  onDone: () => void;
}

export function DoneStep({ provider, isActive, onDone }: DoneStepProps) {
  useInput(
    (_input, key) => {
      if (key.return || key.escape) onDone();
    },
    { isActive }
  );

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="green">
        Setup Complete
      </Text>
      <Text> </Text>
      <Text>
        {provider.displayName} is configured. You can change settings anytime
        with <Text color="cyan">s</Text>.
      </Text>
      <Text> </Text>
      <Text dimColor>Enter to start</Text>
    </Box>
  );
}
