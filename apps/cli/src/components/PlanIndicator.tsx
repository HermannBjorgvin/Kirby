import { Box, Text } from 'ink';
import { usePlan } from '../context/PlanContext.js';
import { useSidebar } from '../context/SidebarContext.js';
import { useLayout } from '../context/LayoutContext.js';
import { truncate } from '../utils/truncate.js';
import type { PlanItem } from '../plan/plan-types.js';

// Top-right "add-to-cart" indicator: a titled box listing the comments
// queued in the current PR's plan. A sibling of AsyncOpsIndicator (see
// main.tsx), it shares the same 40-col right column but sits a few rows
// down so it clears the async spinner (row 1) and the first toast rows.
//
// Renders `null` when the plan is empty — zero visual weight otherwise.

const INDICATOR_WIDTH = 40;
const EDGE_GUTTER = 2;
// Clear the async spinner (row 1) and a toast or two below it.
const TOP_OFFSET = 4;
// Cap the visible rows so a long plan can't overrun the pane; the rest
// collapse into a "+N more" line.
const MAX_ROWS = 5;

function locationLabel(item: PlanItem): string {
  const file = item.file ?? 'general';
  const base = item.line != null ? `${file}:${item.line}` : file;
  // Show just the basename to keep the line short in the narrow column.
  const slash = base.lastIndexOf('/');
  return slash >= 0 ? base.slice(slash + 1) : base;
}

// Pure presentational box — the titled "Plan (N)" list. Split out from
// the absolute-positioning wrapper so it can be unit-tested without the
// full-screen overlay (which ink-testing-library can't render in
// isolation).
export function PlanIndicatorContent({ items }: { items: PlanItem[] }) {
  const visible = items.slice(0, MAX_ROWS);
  const overflow = items.length - visible.length;
  // Content width inside the bordered box (border 2 + paddingX 2).
  const contentWidth = INDICATOR_WIDTH - 4;

  return (
    <Box
      marginTop={TOP_OFFSET}
      marginRight={EDGE_GUTTER}
      width={INDICATOR_WIDTH}
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      paddingX={1}
    >
      <Text bold color="green">
        Plan ({items.length})
      </Text>
      {visible.map((item) => (
        <Text key={`${item.kind}:${item.id}`} wrap="truncate-end">
          {item.annotation ? (
            <Text color="green">{'✎ '}</Text>
          ) : (
            <Text dimColor>{'• '}</Text>
          )}
          {truncate(`${locationLabel(item)} ${item.body}`, contentWidth - 2)}
        </Text>
      ))}
      {overflow > 0 && <Text dimColor>+{overflow} more</Text>}
    </Box>
  );
}

export function PlanIndicator() {
  const plan = usePlan();
  const { selectedPr } = useSidebar();
  const { termCols, termRows } = useLayout();

  const items = selectedPr ? plan.list(selectedPr.id) : [];
  if (items.length === 0) return null;

  return (
    <Box
      position="absolute"
      // Ink types lag the runtime for offsets — greppable cast, same as
      // AsyncOpsIndicator / ToastContainer.
      {...({ top: 0, left: 0 } as object)}
      width={termCols}
      height={termRows}
      alignItems="flex-start"
      justifyContent="flex-end"
    >
      <PlanIndicatorContent items={items} />
    </Box>
  );
}
