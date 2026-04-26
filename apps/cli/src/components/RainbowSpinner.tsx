import { Text } from 'ink';
import {
  COLORS,
  SPINNER_GLYPHS,
  useSpinnerFrame,
} from '../hooks/useActivity.js';

export function RainbowSpinner() {
  const { frame, colorIndex } = useSpinnerFrame();
  return <Text color={COLORS[colorIndex]}>{SPINNER_GLYPHS[frame]}</Text>;
}
