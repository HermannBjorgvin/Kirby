import { Box } from 'ink';
import { Alert } from '@inkjs/ui';
import { useToastState } from '../context/ToastContext.js';
import { useLayout } from '../context/LayoutContext.js';

// Width of the toast column — toasts align to one side inside it, so
// long messages fill out the full 40 cols and short ones hug the edge.
const TOAST_WIDTH = 40;
// Gutter between the toast stack and the nearest terminal edges.
const EDGE_GUTTER = 2;

export type ToastPosition =
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left';

interface ToastContainerProps {
  position?: ToastPosition;
}

// Outer wrapper anchors. The wrapper is a row flex (Ink's default
// flexDirection), so `alignItems` controls VERTICAL placement
// (cross-axis) and `justifyContent` controls HORIZONTAL placement
// (main-axis). The inner stack is a column flex — its alignItems
// switches axes (cross becomes horizontal). Don't confuse the two.
const ANCHOR: Record<
  ToastPosition,
  {
    alignItems: 'flex-start' | 'flex-end';
    justifyContent: 'flex-start' | 'flex-end';
  }
> = {
  'top-right': { alignItems: 'flex-start', justifyContent: 'flex-end' },
  'top-left': { alignItems: 'flex-start', justifyContent: 'flex-start' },
  'bottom-right': { alignItems: 'flex-end', justifyContent: 'flex-end' },
  'bottom-left': { alignItems: 'flex-end', justifyContent: 'flex-start' },
};

// Floating toast stack. Renders nothing when there are no toasts, so
// it adds zero visual weight in the common case.
//
// ── Positioning strategy ───────────────────────────────────────────
// A full-screen `position="absolute"` wrapper anchored at top-left
// with explicit `width`/`height` from LayoutContext, then flex-align
// inside it to push the inner stack into the chosen corner. This is
// the same pattern Modal uses. We can't use `top`/`right` offsets
// directly to push an element into a corner — Ink's runtime accepts
// them but non-zero values don't reliably apply.
//
// ── Input layering ─────────────────────────────────────────────────
// Toasts don't capture input — they're non-interactive. So this
// component doesn't need to coordinate with any `useInput` hooks.
// (Modals are different — see Modal.tsx for the input-layering note.)
export function ToastContainer({
  position = 'top-right',
}: ToastContainerProps = {}) {
  const { toasts } = useToastState();
  const { termCols, termRows } = useLayout();

  if (toasts.length === 0) return null;

  const anchor = ANCHOR[position];
  const isTop = position === 'top-right' || position === 'top-left';
  const isRight = position === 'top-right' || position === 'bottom-right';

  return (
    <Box
      position="absolute"
      // Ink supports this offset; types lag. Same greppable cast as Modal.
      {...({ top: 0, left: 0 } as object)}
      width={termCols}
      height={termRows}
      alignItems={anchor.alignItems}
      justifyContent={anchor.justifyContent}
    >
      <Box
        flexDirection="column"
        gap={1}
        marginTop={isTop ? EDGE_GUTTER : 0}
        marginBottom={isTop ? 0 : EDGE_GUTTER}
        marginLeft={isRight ? 0 : EDGE_GUTTER}
        marginRight={isRight ? EDGE_GUTTER : 0}
        width={TOAST_WIDTH}
        // `alignItems` on a column flex controls the cross-axis
        // (horizontal) — this right- or left-aligns each toast inside
        // the 40-col stack so short messages don't float awkwardly.
        alignItems={isRight ? 'flex-end' : 'flex-start'}
      >
        {toasts.map((t) => (
          <Alert key={t.id} variant={t.variant}>
            {t.message}
          </Alert>
        ))}
      </Box>
    </Box>
  );
}
