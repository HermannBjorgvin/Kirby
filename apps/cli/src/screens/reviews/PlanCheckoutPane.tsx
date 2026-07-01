import { memo } from 'react';
import { Box, Text } from 'ink';
import { truncate } from '../../utils/truncate.js';
import { planItemKey, type PlanItem } from '../../plan/plan-types.js';

// Presentational checkout pane: a checklist of plan items with an
// include/exclude toggle, inline note editing, and a send action. When
// an agent is already running in the worktree, a small inject-vs-restart
// choice replaces the checklist hints. All state is driven by props;
// input handling lives in plan-checkout-input.ts.

function locationLabel(item: PlanItem): string {
  const file = item.file ?? 'general';
  return item.line != null ? `${file}:${item.line}` : file;
}

export const PlanCheckoutPane = memo(function PlanCheckoutPane({
  items,
  selectedIndex,
  paneCols,
  annotatingPlanKey,
  annotationBuffer,
  target,
}: {
  items: PlanItem[];
  selectedIndex: number;
  paneCols: number;
  annotatingPlanKey?: string | null;
  annotationBuffer?: string;
  /** When set, render the inject-vs-restart choice instead of hints. */
  target?: 'inject' | 'new-session' | null;
}) {
  const bodyWidth = Math.max(20, paneCols - 8);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Text bold color="blue">
        Plan Checkout ({items.length})
      </Text>
      <Text dimColor>{'─'.repeat(Math.min(40, paneCols - 2))}</Text>

      {items.length === 0 && <Text dimColor>(plan is empty)</Text>}

      <Box flexDirection="column">
        {items.map((item, idx) => {
          const selected = idx === selectedIndex;
          const key = planItemKey(item.kind, item.id);
          const tag =
            item.kind === 'local' ? `[${item.severity}] ` : '';
          return (
            <Box key={key} flexDirection="column">
              <Text wrap="truncate-end">
                <Text color="green">{'[x] '}</Text>
                <Text color={selected ? 'cyan' : undefined} bold={selected}>
                  {locationLabel(item)}
                </Text>
                <Text dimColor>{'  '}{tag}{truncate(item.body, bodyWidth)}</Text>
              </Text>
              {item.annotation && annotatingPlanKey !== key && (
                <Text wrap="truncate-end">
                  <Text color="green">{'    ✎ '}</Text>
                  <Text dimColor>{truncate(item.annotation, bodyWidth)}</Text>
                </Text>
              )}
              {annotatingPlanKey === key && (
                <Box marginLeft={4} marginY={0}>
                  <Box borderStyle="round" borderColor="green" paddingX={1}>
                    <Text>
                      <Text color="green">{'note '}</Text>
                      {annotationBuffer ?? ''}▍
                    </Text>
                  </Box>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        {target ? (
          <Text>
            <Text dimColor>An agent is already running. </Text>
            <Text color={target === 'inject' ? 'cyan' : undefined}>
              {target === 'inject' ? '› ' : '  '}Inject into it
            </Text>
            <Text dimColor>{'   '}</Text>
            <Text color={target === 'new-session' ? 'cyan' : undefined}>
              {target === 'new-session' ? '› ' : '  '}Restart with plan
            </Text>
            <Text dimColor>{'  ·  [↑/↓] choose · [enter] send · [esc] back'}</Text>
          </Text>
        ) : (
          <Text dimColor>
            <Text color="cyan">[space]</Text> remove ·{' '}
            <Text color="cyan">[a]</Text> note ·{' '}
            <Text color="cyan">[enter]</Text> send to agent ·{' '}
            <Text color="cyan">[esc]</Text> back
          </Text>
        )}
      </Box>
    </Box>
  );
});
