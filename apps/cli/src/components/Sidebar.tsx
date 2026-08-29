import { memo, useMemo } from 'react';
import { Text, Box } from 'ink';
import type { SidebarItem } from '@kirby/core';
import { useConfig, useKeybindResolve } from '@kirby/app-core';
import {
  SECTION_LABELS,
  buildSidebarRows,
  sidebarAvailableLines,
  sidebarRowHeights,
  sidebarScrollWindow,
  type RenderRow,
} from './sidebar-model.js';
import { PrItemRow, SectionHeader, SessionItemRow } from './SidebarRows.js';
import { SidebarLayout } from './SidebarLayout.js';

export interface SidebarProps {
  items: SidebarItem[];
  selectedIndex: number;
  sidebarWidth: number;
  termRows: number;
  focused: boolean;
  conflictsLoading?: boolean;
  hintsHidden?: boolean;
  /** session-name → 1..10 quick-switch tab number for currently-running
   *  sessions in the active-sessions tab bar. Sessions outside the
   *  bar's 10-tab cap are absent from the map. */
  tabNumbers: Map<string, number>;
}

export const Sidebar = memo(function Sidebar({
  items,
  selectedIndex,
  sidebarWidth,
  termRows,
  focused,
  hintsHidden = false,
  tabNumbers,
}: SidebarProps) {
  const { vcsConfigured } = useConfig();
  const keybinds = useKeybindResolve();

  // Build dynamic keybind hints from the active preset
  const sidebarHints = useMemo(() => {
    const hints = keybinds.getHints('sidebar');

    if (hintsHidden) {
      const toggle = hints.find((h) => h.actionId === 'sidebar.toggle-hints');
      return toggle ? [{ ...toggle, label: 'show hints' }] : [];
    }

    const filtered = vcsConfigured ? hints : hints.filter((h) => !h.vcsOnly);

    // Combine navigate-down + navigate-up into a single "j/k navigate" hint
    const navDownIdx = filtered.findIndex(
      (h) => h.actionId === 'sidebar.navigate-down'
    );
    if (navDownIdx >= 0) {
      const navKeys = keybinds.getNavKeys('sidebar');
      const combined = { ...filtered[navDownIdx]!, keys: navKeys };
      return [
        combined,
        ...filtered.filter(
          (h) =>
            h.actionId !== 'sidebar.navigate-down' &&
            h.actionId !== 'sidebar.navigate-up'
        ),
      ];
    }
    return filtered;
  }, [keybinds, vcsConfigured, hintsHidden]);

  const keybindLineCount = sidebarHints.length;

  const rows = useMemo(() => buildSidebarRows(items), [items]);
  const rowHeights = useMemo(
    () => sidebarRowHeights(rows, vcsConfigured),
    [rows, vcsConfigured]
  );

  const { fullyVisibleRows, gap, aboveCount, belowCount } = useMemo(
    () =>
      sidebarScrollWindow({
        rows,
        rowHeights,
        selectedIndex,
        availableLines: sidebarAvailableLines({
          termRows,
          keybindLineCount,
          vcsConfigured,
          hintsHidden,
        }),
      }),
    [
      rows,
      rowHeights,
      selectedIndex,
      termRows,
      vcsConfigured,
      keybindLineCount,
      hintsHidden,
    ]
  );

  const renderRow = (row: RenderRow) => {
    if (row.type === 'header') {
      const label = SECTION_LABELS[row.key];
      return (
        <SectionHeader
          key={`section-${row.key}`}
          title={label.title}
          color={label.color}
          count={row.count}
          first={row.first}
        />
      );
    }
    const { item, itemIndex } = row;
    const selected = itemIndex === selectedIndex;

    if (item.kind === 'session') {
      return (
        <SessionItemRow
          key={`s-${item.session.name}`}
          session={item.session}
          selected={selected}
          pr={item.pr}
          sidebarWidth={sidebarWidth}
          isMerged={item.isMerged}
          conflictCount={item.conflictCount}
          vcsConfigured={vcsConfigured}
          tabNumber={tabNumbers.get(item.session.name)}
        />
      );
    }
    if (item.kind === 'orphan-pr') {
      return (
        <PrItemRow
          key={`o-${item.pr.id}`}
          pr={item.pr}
          selected={selected}
          sidebarWidth={sidebarWidth}
          running={item.running}
        />
      );
    }
    return (
      <PrItemRow
        key={`r-${item.pr.id}`}
        pr={item.pr}
        selected={selected}
        sidebarWidth={sidebarWidth}
        running={item.running}
        author={item.pr.createdByDisplayName || 'unknown'}
      />
    );
  };

  return (
    <SidebarLayout
      title="😸 Kirby"
      focused={focused}
      sidebarWidth={sidebarWidth}
      emptyText="(no sessions)"
      isEmpty={items.length === 0}
      keybinds={
        <>
          {sidebarHints.map((hint) => (
            <Text key={hint.actionId} dimColor>
              <Text color="cyan">{hint.keys}</Text> {hint.label}
            </Text>
          ))}
        </>
      }
      legend={
        vcsConfigured && !hintsHidden ? (
          <>
            <Text dimColor>🔧✅ passed 🔧🔥 failed 🔧⏳ pending</Text>
            <Text dimColor>🔔 needs attention ⭐ fully approved</Text>
          </>
        ) : undefined
      }
    >
      {aboveCount > 0 && <Text dimColor>↑ {aboveCount} more</Text>}
      {fullyVisibleRows.map((row) => renderRow(row))}
      {gap > 0 && belowCount > 0 && <Box height={gap} />}
      {belowCount > 0 && <Text dimColor>↓ {belowCount} more</Text>}
    </SidebarLayout>
  );
});
