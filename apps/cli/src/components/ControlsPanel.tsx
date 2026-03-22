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

// ── Component ──────────────────────────────────────────────────────

export function ControlsPanel({
  scrollOffset,
  paneRows,
  selectedIndex,
  rebindActionId,
}: {
  scrollOffset: number;
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

  // Viewport calculations
  const headerLines = 3; // title + preset + separator
  const footerLines = rebindAction ? 3 : 2; // rebind prompt or hint
  const viewportHeight = Math.max(1, paneRows - headerLines - footerLines);
  const clampedOffset = Math.max(
    0,
    Math.min(scrollOffset, rows.length - viewportHeight)
  );
  const visibleRows = rows.slice(clampedOffset, clampedOffset + viewportHeight);

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

      {clampedOffset + viewportHeight < rows.length ? (
        <Text dimColor>
          ↓ {rows.length - clampedOffset - viewportHeight} more
        </Text>
      ) : null}

      <Box marginTop={1}>
        {rebindAction ? (
          <Text color="yellow">
            Press a key to bind <Text bold>{rebindAction.label}</Text>
            <Text dimColor> · Esc cancel · Del reset</Text>
          </Text>
        ) : (
          <Text dimColor>
            j/k navigate · Enter rebind · ←/→ change preset · Esc back
          </Text>
        )}
      </Box>
    </Box>
  );
}
