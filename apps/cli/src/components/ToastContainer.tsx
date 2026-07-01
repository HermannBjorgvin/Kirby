import { Box } from 'ink';
import { Alert } from '@inkjs/ui';
import { useToastState } from '../context/ToastContext.js';

// Width of the toast column — toasts align to the right inside it, so
// long messages fill out the full 40 cols and short ones hug the edge.
const TOAST_WIDTH = 40;

// Margin-free toast stack, or null when there are nothing to show.
// Positioning is owned by TopRightOverlay, which stacks this below the
// async-ops row and the plan indicator. Toasts are non-interactive, so
// this doesn't coordinate with any `useInput` hooks.
export function ToastStack() {
  const { toasts } = useToastState();
  if (toasts.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      gap={1}
      width={TOAST_WIDTH}
      // `alignItems` on a column flex controls the cross-axis
      // (horizontal) — right-aligns each toast inside the 40-col stack so
      // short messages don't float awkwardly.
      alignItems="flex-end"
    >
      {toasts.map((t) => (
        <Alert key={t.id} variant={t.variant}>
          {t.message}
        </Alert>
      ))}
    </Box>
  );
}
