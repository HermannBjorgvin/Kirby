import { Text, Box } from 'ink';

interface DividerProps {
  title?: string;
  titleColor?: string;
  dividerColor?: string;
  padding?: number;
}

function Fill({ char = '─', color }: { char?: string; color?: string }) {
  return (
    <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
      <Text color={color}>{char.repeat(200)}</Text>
    </Box>
  );
}

export function Divider({
  title,
  titleColor = 'white',
  dividerColor = 'gray',
  padding = 0,
}: DividerProps) {
  if (!title) {
    return (
      <Box paddingLeft={padding} paddingRight={padding} height={1}>
        <Fill color={dividerColor} />
      </Box>
    );
  }

  return (
    <Box paddingLeft={padding} paddingRight={padding} gap={1} height={1}>
      <Fill color={dividerColor} />
      <Box flexShrink={0}>
        <Text color={titleColor} bold>
          {title}
        </Text>
      </Box>
      <Fill color={dividerColor} />
    </Box>
  );
}
