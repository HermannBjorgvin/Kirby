import { useMemo } from 'react';
import { Text, Box } from 'ink';
import { useKeybinds } from '../context/KeybindContext.js';
import { ACTIONS, keysToDisplayString } from '../keybindings/index.js';
import type { InputContext } from '../keybindings/index.js';

// ── Section config ─────────────────────────────────────────────────

const CONTEXT_LABELS: Record<InputContext, string> = {
  sidebar: 'Sidebar',
  settings: 'Settings',
  'branch-picker': 'Branch Picker',
  confirm: 'Confirm Dialog',
  'confirm-delete': 'Confirm Delete',
  'diff-file-list': 'Diff File List',
  'diff-viewer': 'Diff Viewer',
  controls: 'Controls',
};

const CONTEXT_ORDER: InputContext[] = [
  'sidebar',
  'diff-viewer',
  'diff-file-list',
  'settings',
  'branch-picker',
  'confirm',
  'confirm-delete',
];

// ── Row types ──────────────────────────────────────────────────────

export type ControlsRow =
  | { type: 'header'; label: string }
  | {
      type: 'binding';
      actionId: string;
      keys: string;
      label: string;
      isCustom: boolean;
    };

/** Build the flat list of rows for the controls panel */
export function buildControlsRows(
  bindings: Record<string, unknown[]>,
  isCustom: (id: string) => boolean
): ControlsRow[] {
  const result: ControlsRow[] = [];

  for (const context of CONTEXT_ORDER) {
    const contextActions = ACTIONS.filter((a) => a.context === context);
    if (contextActions.length === 0) continue;

    result.push({ type: 'header', label: CONTEXT_LABELS[context] });

    for (const action of contextActions) {
      const descs = bindings[action.id];
      if (!descs || descs.length === 0) continue;
      result.push({
        type: 'binding',
        actionId: action.id,
        keys: keysToDisplayString(
          descs as Parameters<typeof keysToDisplayString>[0]
        ),
        label: action.label,
        isCustom: isCustom(action.id),
      });
    }
  }
  return result;
}

/** Get only binding rows (no headers), for index-based navigation */
export function getBindingRows(rows: ControlsRow[]) {
  return rows.filter(
    (r): r is Extract<ControlsRow, { type: 'binding' }> => r.type === 'binding'
  );
}

// ── Hints sub-component (isolates context subscription from parent) ──

function ControlsHints({ rebindLabel }: { rebindLabel: string | null }) {
  const kb = useKeybinds();
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
  const { presetName, bindings, isCustom } = useKeybinds();

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
            <Box key={`h-${i}`} marginTop={i === 0 ? 0 : 1}>
              <Text bold color="blue">
                {row.label}
              </Text>
            </Box>
          );
        }
        const isSelected = row.actionId === selectedActionId;
        const isRebinding = row.actionId === rebindActionId;
        return (
          <Text key={`b-${i}`}>
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
