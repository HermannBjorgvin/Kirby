import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { useAppState } from '../context/AppStateContext.js';
import { useLayout } from '../context/LayoutContext.js';
import type { OperationName } from '../hooks/useAsyncOperation.js';

// Human-readable labels for each async operation. Falls back to the
// raw op name if an entry is missing — keeps us from crashing on a
// new op that forgot its label.
const OP_LABELS: Partial<Record<OperationName, string>> = {
  sync: 'Syncing with origin',
  rebase: 'Rebasing',
  'fetch-branches': 'Fetching branches',
  'create-worktree': 'Creating session',
  delete: 'Deleting session',
  'check-delete': 'Checking session',
  'start-session': 'Starting agent',
  'open-editor': 'Opening editor',
  'refresh-pr': 'Refreshing PRs',
  'post-comment': 'Posting comment',
};

// Width reservation for the spinner + label. Roughly enough for the
// longest op name list we expect (e.g. "sync, rebase, fetch-branches").
const INDICATOR_WIDTH = 40;
// 2-col gutter from the right edge — matches ToastContainer's EDGE_GUTTER
// so the spinner lines up visually with the toasts below it.
const EDGE_GUTTER = 2;
// Row 1 puts the spinner on the pane's title row (inside the top
// border). Paints to the right of the title text — no overlap in
// practice because titles are left-aligned and this is right-aligned.
const TOP_ROW = 1;

// Absolutely-positioned loading indicator in the top-right corner.
// Shown while any async operations are in flight (`asyncOps.inFlight`
// is non-empty). The label next to the spinner says what's loading
// (comma-separated op names).
//
// Renders `null` when idle — zero visual weight.
//
// Positioning strategy mirrors ToastContainer: full-screen
// `position="absolute"` wrapper with explicit width/height from
// LayoutContext, then flex-align inside to push the indicator to the
// top-right. The inner stack is a column so future additions (e.g. a
// second indicator row) would stack below the spinner naturally.
export function AsyncOpsIndicator() {
  const { asyncOps } = useAppState();
  const { termCols, termRows } = useLayout();

  if (asyncOps.inFlight.size === 0) return null;

  const label = [...asyncOps.inFlight]
    .map((op) => OP_LABELS[op] ?? op)
    .join(', ');

  return (
    <Box
      position="absolute"
      // Same as Modal / ToastContainer — Ink types lag the runtime for
      // offsets. Greppable cast.
      {...({ top: 0, left: 0 } as object)}
      width={termCols}
      height={termRows}
      alignItems="flex-start"
      justifyContent="flex-end"
    >
      <Box
        marginTop={TOP_ROW}
        marginRight={EDGE_GUTTER}
        width={INDICATOR_WIDTH}
        // Row flex: main-axis is horizontal, so justifyContent pushes
        // the label+spinner pair to the right edge of the 40-col
        // reserved column. Inside the row, label renders first and
        // the spinner second — so the animated character sits on the
        // RIGHT of the text.
        justifyContent="flex-end"
        gap={1}
      >
        <Text>{label}</Text>
        <Spinner />
      </Box>
    </Box>
  );
}
