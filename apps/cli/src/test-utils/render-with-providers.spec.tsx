import { describe, it, expect } from 'vitest';
import { Box, Text } from 'ink';
import { renderWithProviders } from './render-with-providers.js';

describe('renderWithProviders', () => {
  it('renders a Box inside the provider stack', () => {
    const { lastFrame, unmount } = renderWithProviders(
      <Box>
        <Text>hello</Text>
      </Box>
    );
    expect(lastFrame()).toContain('hello');
    unmount();
  });
});
