import { Box } from 'ink';
import { useLayout } from '../context/LayoutContext.js';
import { AsyncOpsContent } from './AsyncOpsIndicator.js';
import { PlanIndicatorSection } from './PlanIndicator.js';
import { ToastStack } from './ToastContainer.js';

// Unified top-right overlay. A single full-screen `position="absolute"`
// box anchors a column into the top-right corner; inside it, three
// stacked sections flow naturally:
//
//   1. Async-ops spinner (while operations are in flight)
//   2. Plan indicator    (while the current PR has queued comments)
//   3. Toast stack        (transient status messages)
//
// Each section renders `null` when it has nothing to show, and `gap`
// only spaces the sections that actually render — so with no async ops
// the plan sits at the very top, and it drops down a row when a spinner
// appears above it. This replaces three independently-positioned
// overlays that previously overlapped in the same corner.
//
// Gutter matches the old EDGE_GUTTER/TOP_ROW so the stack lines up on
// the pane's title row, two cols from the right edge.
const EDGE_GUTTER = 2;
const TOP_ROW = 1;

interface TopRightOverlayProps {
  hidePlanIndicator?: boolean;
}

export function TopRightOverlay({ hidePlanIndicator }: TopRightOverlayProps) {
  const { termCols, termRows } = useLayout();

  return (
    <Box
      position="absolute"
      // Ink types lag the runtime for offsets — greppable cast, same as
      // Modal.
      {...({ top: 0, left: 0 } as object)}
      width={termCols}
      height={termRows}
      alignItems="flex-start"
      justifyContent="flex-end"
    >
      <Box
        flexDirection="column"
        marginTop={TOP_ROW}
        marginRight={EDGE_GUTTER}
        alignItems="flex-end"
        gap={1}
      >
        <AsyncOpsContent />
        {!hidePlanIndicator && <PlanIndicatorSection />}
        <ToastStack />
      </Box>
    </Box>
  );
}
