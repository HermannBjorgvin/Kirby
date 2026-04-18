import { Text, Box, useInput } from 'ink';
import type { AppConfig, VcsProvider } from '@kirby/vcs-core';

interface WelcomeStepProps {
  provider: VcsProvider;
  config: AppConfig;
  isActive: boolean;
  onContinue: () => void;
  onSkip: () => void;
}

export function WelcomeStep({
  provider,
  config,
  isActive,
  onContinue,
  onSkip,
}: WelcomeStepProps) {
  useInput(
    (_input, key) => {
      if (key.escape) return onSkip();
      if (key.return) return onContinue();
    },
    { isActive }
  );

  const org = config.vendorProject.org || config.vendorProject.owner;
  const project = config.vendorProject.project || config.vendorProject.repo;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyan">
        Welcome to Kirby
      </Text>
      <Text> </Text>
      <Text>
        Detected{' '}
        <Text bold color="magenta">
          {provider.displayName}
        </Text>{' '}
        project
      </Text>
      {org ? <Text dimColor> Organization/Owner: {org}</Text> : null}
      {project ? <Text dimColor> Project/Repository: {project}</Text> : null}
      <Text> </Text>
      <Text>Let&apos;s review your settings.</Text>
      <Text> </Text>
      <Text dimColor>Enter to continue · Esc to skip</Text>
    </Box>
  );
}
