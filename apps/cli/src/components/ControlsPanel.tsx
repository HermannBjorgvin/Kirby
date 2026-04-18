import { useMemo } from 'react';
import { Text, Box } from 'ink';
import { useKeybindResolve } from '../context/KeybindContext.js';
import { ACTIONS } from '../keybindings/index.js';
import {
  buildControlsRows,
  getBindingRows,
} from '../keybindings/controls-data.js';

// ── Hints sub-component (isolates context subscription from parent) ──

function ControlsHints({ rebindLabel }: { rebindLabel: string | null }) {
  const kb = useKeybindResolve();
  const navKeys = kb.getHintKeys('controls.navigate-down');
  const rebindKeys = kb.getHintKeys('controls.rebind');
  const cycleLeft = kb.getHintKeys('controls.cycle-left');
  const cycleRight = kb.getHintKeys('controls.cycle-right');
  const closeKeys = kb.getHintKeys('controls.close');

  if (rebindLabel) {
    return (
      <Box marginTop={1}>
        <Text color="yellow">
          Press a key to bind <Text bold>{rebindLabel}</Text>
          <Text dimColor> · {closeKeys} cancel · Del reset</Text>
        </Text>
      </Box>
    );
  }

  return (
    <Box marginTop={1}>
      <Text dimColor>
        <Text color="cyan">{navKeys}</Text> navigate ·{' '}
        <Text color="cyan">{rebindKeys}</Text> rebind ·{' '}
        <Text color="cyan">
          {cycleLeft}/{cycleRight}
        </Text>{' '}
        change preset · <Text color="cyan">{closeKeys}</Text> back
      </Text>
    </Box>
  );
}

// ── Component ──────────────────────────────────────────────────────

export function ControlsPanel({
  paneRows,
  selectedIndex,
  rebindActionId,
}: {
  paneRows: number;
  selectedIndex: number;
  rebindActionId: string | null;
}) {
  const { presetName, bindings, isCustom } = useKeybindResolve();

  const rows = useMemo(
    () => buildControlsRows(bindings, isCustom),
    [bindings, isCustom]
  );

  const bindingRows = useMemo(() => getBindingRows(rows), [rows]);
  const selectedActionId = bindingRows[selectedIndex]?.actionId ?? null;

  // Find the action being rebound for the prompt
  const rebindAction = rebindActionId
    ? ACTIONS.find((a) => a.id === rebindActionId)
    : null;

  // Derive scroll offset from selected index:
  // find the flat row index of the selected binding, then center it
  const headerLines = 3; // title + preset + separator
  const footerLines = rebindAction ? 3 : 2;
  const viewportHeight = Math.max(1, paneRows - headerLines - footerLines);

  const selectedFlatIdx = useMemo(() => {
    if (!selectedActionId) return 0;
    return rows.findIndex(
      (r) => r.type === 'binding' && r.actionId === selectedActionId
    );
  }, [rows, selectedActionId]);

  const scrollOffset = useMemo(() => {
    if (rows.length <= viewportHeight) return 0;
    // Center the selected row in the viewport
    const half = Math.floor(viewportHeight / 2);
    const ideal = Math.max(0, selectedFlatIdx - half);
    return Math.min(ideal, rows.length - viewportHeight);
  }, [selectedFlatIdx, viewportHeight, rows.length]);

  const visibleRows = rows.slice(scrollOffset, scrollOffset + viewportHeight);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold color="magenta">
        Controls
      </Text>
      <Text>
        <Text dimColor>Preset: </Text>
        <Text bold color="cyan">
          {presetName}
        </Text>
        <Text dimColor> ←/→ to change</Text>
      </Text>
      <Text dimColor>{'─'.repeat(40)}</Text>

      {visibleRows.map((row, i) => {
        if (row.type === 'header') {
          return (
            <Box key={`h-${row.label}`} marginTop={i === 0 ? 0 : 1}>
              <Text bold color="blue">
                {row.label}
              </Text>
            </Box>
          );
        }
        const isSelected = row.actionId === selectedActionId;
        const isRebinding = row.actionId === rebindActionId;
        return (
          <Text key={row.actionId}>
            <Text color={isSelected ? 'cyan' : undefined}>
              {isSelected ? '› ' : '  '}
            </Text>
            <Text color={isRebinding ? 'yellow' : 'cyan'} bold={isRebinding}>
              {(isRebinding ? '...' : row.keys).padEnd(12)}
            </Text>
            <Text bold={isSelected}>{row.label}</Text>
            {row.isCustom ? <Text color="yellow"> *</Text> : null}
          </Text>
        );
      })}

      {scrollOffset + viewportHeight < rows.length ? (
        <Text dimColor>
          ↓ {rows.length - scrollOffset - viewportHeight} more
        </Text>
      ) : null}

      <ControlsHints rebindLabel={rebindAction?.label ?? null} />
    </Box>
  );
}
