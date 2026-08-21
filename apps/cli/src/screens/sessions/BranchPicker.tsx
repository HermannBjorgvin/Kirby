import { memo, useMemo } from 'react';
import { Text, Box, useInput } from 'ink';
import { computeScrollWindow } from '../../utils/scroll-window.js';
import {
  useBranchPickerState,
  useBranchPickerActions,
} from '../../context/ModalContext.js';
import { useSessionActions } from '../../context/SessionContext.js';
import { useAsyncOps } from '../../context/AsyncOpsContext.js';
import { useConfig } from '../../context/ConfigContext.js';
import { useKeybindResolve } from '../../context/KeybindContext.js';
import { useLayout } from '../../context/LayoutContext.js';
import { useSidebar } from '../../context/SidebarContext.js';
import {
  buildAgentOptions,
  handleBranchPickerInput,
} from '../main/branch-picker-input.js';

export const BranchPicker = memo(function BranchPicker({
  filter,
  branches,
  selectedIndex,
  paneRows,
}: {
  filter: string;
  branches: string[];
  selectedIndex: number;
  paneRows: number;
}) {
  // ── Input handling ────────────────────────────────────────────
  // Moved out of MainTab so the branch picker owns its own keypress
  // routing. The `isActive` guard keeps the hook attached only while
  // the picker is on screen; MainTab's always-on no-op useInput holds
  // Ink's raw-mode ref-count steady either way.
  const branchPickerState = useBranchPickerState();
  const branchPickerActions = useBranchPickerActions();
  const branchPicker = useMemo(
    () => ({ ...branchPickerState, ...branchPickerActions }),
    [branchPickerState, branchPickerActions]
  );
  const sessions = useSessionActions();
  const sidebar = useSidebar();
  const asyncOps = useAsyncOps();
  const config = useConfig();
  const keybinds = useKeybindResolve();
  const { terminal } = useLayout();

  useInput(
    (input, key) => {
      handleBranchPickerInput(input, key, {
        branchPicker,
        sessions,
        sidebar,
        asyncOps,
        terminal,
        config,
        keybinds,
      });
    },
    { isActive: branchPicker.creating }
  );

  const filtered = branches.filter((b) =>
    b.toLowerCase().includes(filter.toLowerCase())
  );
  const hasExactMatch = branches.some(
    (b) => b.toLowerCase() === filter.toLowerCase()
  );
  const showCreateHint =
    filter.length > 0 && !hasExactMatch && filtered.length > 0;

  const agentOptions = useMemo(
    () => buildAgentOptions(config.config),
    [config.config]
  );
  const safeAgentIdx = Math.min(
    Math.max(branchPicker.agentIndex, 0),
    agentOptions.length - 1
  );
  const agentName = agentOptions[safeAgentIdx]?.name ?? 'Agent';

  // Windowed rendering: derive visible slice from props
  // chrome rows = title + agent row + divider + hints
  // (+ optional create hint)
  const chromeRows = 4 + (showCreateHint ? 2 : 0);
  const maxVisible = Math.max(1, paneRows - chromeRows);
  const needsIndicators = filtered.length > maxVisible;
  const indicatorRows = needsIndicators ? 2 : 0;
  const listRows = maxVisible - indicatorRows;

  const { windowStart, aboveCount, belowCount } = computeScrollWindow({
    totalItems: filtered.length,
    selectedIndex,
    maxVisible: listRows,
  });
  const visibleBranches = filtered.slice(
    windowStart,
    windowStart + Math.max(1, listRows)
  );

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Text bold color="yellow">
        Branch Picker
        {filter.length > 0 && (
          <Text dimColor>
            {' '}
            / {filter}
            <Text color="cyan">_</Text>
          </Text>
        )}
      </Text>
      <Text>
        <Text bold>Agent: </Text>
        <Text color="cyan">{agentName}</Text>
        <Text dimColor> ←/→ to change (this session only)</Text>
      </Text>
      <Text dimColor>{'─'.repeat(40)}</Text>
      <Text dimColor>
        <Text color="cyan">↑↓</Text> navigate · <Text color="cyan">Ctrl+f</Text>{' '}
        fetch · <Text color="cyan">Enter</Text> select ·{' '}
        <Text color="cyan">Esc</Text> cancel
      </Text>
      {filtered.length === 0 ? (
        <Box flexDirection="column">
          {filter.length > 0 ? (
            <Text color="yellow">
              (new branch) <Text bold>{filter}</Text>
            </Text>
          ) : (
            <Text dimColor>Type to filter branches...</Text>
          )}
        </Box>
      ) : (
        <Box flexDirection="column">
          {aboveCount > 0 && <Text dimColor>↑ {aboveCount} more</Text>}
          {visibleBranches.map((b, i) => {
            const realIndex = windowStart + i;
            const isSelected = realIndex === selectedIndex;
            return (
              <Text key={b}>
                <Text color={isSelected ? 'cyan' : undefined}>
                  {isSelected ? '› ' : '  '}
                </Text>
                <Text bold={isSelected}>{b}</Text>
              </Text>
            );
          })}
          {belowCount > 0 && <Text dimColor>↓ {belowCount} more</Text>}
          {showCreateHint && (
            <Box marginTop={1}>
              <Text dimColor>
                Enter to create: <Text color="yellow">{filter}</Text>
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
});
