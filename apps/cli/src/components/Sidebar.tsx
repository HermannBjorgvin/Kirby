import { memo, useMemo } from 'react';
import { Text, Box } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { AgentSession, SidebarItem } from '../types.js';
import { PrBadge } from './PrBadge.js';
import { SidebarLayout } from './SidebarLayout.js';
import { truncate } from '../utils/truncate.js';
import { computeScrollWindow } from '../utils/scroll-window.js';
import { useConfig } from '../context/ConfigContext.js';
import { useKeybinds } from '../context/KeybindContext.js';

// ── Constants ───────────────────────────────────────────────────

// Header: 1 line of text + 1 marginBottom = 2 lines
const HEADER_LINES = 2;
const LEGEND_LINES = 2; // "passed/failed/pending" + "needs attention/approved"

// ── Section header detection ────────────────────────────────────

type SectionKey =
  | 'pull-requests'
  | 'draft-pull-requests'
  | 'needs-review'
  | 'waiting'
  | 'approved';

function getSectionKey(item: SidebarItem): SectionKey {
  if (item.kind === 'session') return 'pull-requests';
  if (item.kind === 'orphan-pr')
    return item.pr.isDraft ? 'draft-pull-requests' : 'pull-requests';
  return item.category;
}

const SECTION_LABELS: Record<SectionKey, { title: string; color: string }> = {
  'pull-requests': { title: 'Pull Requests', color: 'blue' },
  'draft-pull-requests': { title: 'Draft Pull Requests', color: 'gray' },
  'needs-review': { title: 'Needs Your Review', color: 'red' },
  waiting: { title: 'Waiting for Author', color: 'yellow' },
  approved: { title: 'Approved by You', color: 'green' },
};

// ── Sub-components ──────────────────────────────────────────────

const SessionItemRow = memo(function SessionItemRow({
  session,
  selected,
  pr,
  sidebarWidth,
  isMerged,
  conflictCount,
  vcsConfigured,
}: {
  session: AgentSession;
  selected: boolean;
  pr: PullRequestInfo | undefined;
  sidebarWidth: number;
  isMerged: boolean;
  conflictCount: number | undefined;
  vcsConfigured: boolean;
}) {
  const icon = session.running ? '●' : '○';
  const color = session.running ? 'green' : 'gray';

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={selected ? 'cyan' : undefined}>
          {selected ? '› ' : '  '}
        </Text>
        <Text color={color}>{icon} </Text>
        <Text bold={selected}>{truncate(pr?.title || session.name, 42)}</Text>
        {isMerged ? (
          <Text dimColor color="green">
            {' '}
            merged
          </Text>
        ) : null}
      </Text>
      {conflictCount != null && conflictCount > 0 ? (
        <Text dimColor color="yellow">
          {'    '}
          {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}
        </Text>
      ) : null}
      {vcsConfigured ? <PrBadge pr={pr} sidebarWidth={sidebarWidth} /> : null}
    </Box>
  );
});

const OrphanPrRow = memo(function OrphanPrRow({
  pr,
  selected,
  sidebarWidth,
  running,
}: {
  pr: PullRequestInfo;
  selected: boolean;
  sidebarWidth: number;
  running?: boolean;
}) {
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={selected ? 'cyan' : undefined}>
          {selected ? '› ' : '  '}
        </Text>
        {running != null && (
          <Text color={running ? 'green' : 'gray'}>
            {running ? '● ' : '○ '}
          </Text>
        )}
        <Text bold={selected}>{truncate(pr.title || pr.sourceBranch, 42)}</Text>
      </Text>
      <PrBadge pr={pr} sidebarWidth={sidebarWidth} />
    </Box>
  );
});

const ReviewPrRow = memo(function ReviewPrRow({
  pr,
  selected,
  sidebarWidth,
  innerWidth,
  running,
}: {
  pr: PullRequestInfo;
  selected: boolean;
  sidebarWidth: number;
  innerWidth: number;
  running?: boolean;
}) {
  const ledWidth = running != null ? 2 : 0;
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={selected ? 'cyan' : undefined}>
          {selected ? '› ' : '  '}
        </Text>
        {running != null && (
          <Text color={running ? 'green' : 'gray'}>
            {running ? '● ' : '○ '}
          </Text>
        )}
        <Text bold={selected}>
          {truncate(pr.title || pr.sourceBranch, innerWidth - 4 - ledWidth)}
        </Text>
      </Text>
      <PrBadge
        pr={pr}
        sidebarWidth={sidebarWidth}
        author={pr.createdByDisplayName || 'unknown'}
      />
    </Box>
  );
});

function SectionHeader({
  title,
  color,
  count,
  innerWidth,
  first,
}: {
  title: string;
  color: string;
  count: number;
  innerWidth: number;
  first: boolean;
}) {
  return (
    <Box flexDirection="column" marginTop={first ? 0 : 1}>
      <Text bold color={color}>
        {title} ({count})
      </Text>
      <Text dimColor>{'─'.repeat(Math.max(1, innerWidth))}</Text>
    </Box>
  );
}

// ── Main component ──────────────────────────────────────────────

export interface SidebarProps {
  items: SidebarItem[];
  selectedIndex: number;
  sidebarWidth: number;
  termRows: number;
  focused: boolean;
  conflictsLoading?: boolean;
}

export const Sidebar = memo(function Sidebar({
  items,
  selectedIndex,
  sidebarWidth,
  termRows,
  focused,
}: SidebarProps) {
  const { vcsConfigured } = useConfig();
  const keybinds = useKeybinds();
  const innerWidth = Math.max(10, sidebarWidth - 2);

  // Build dynamic keybind hints from the active preset
  const sidebarHints = useMemo(() => {
    const hints = keybinds.getHints('sidebar');
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
  }, [keybinds, vcsConfigured]);

  const keybindLineCount = sidebarHints.length;

  // Build renderable rows (items + section headers)
  type RenderRow =
    | { type: 'header'; key: SectionKey; count: number; first: boolean }
    | { type: 'item'; item: SidebarItem; itemIndex: number };

  const rows = useMemo(() => {
    const result: RenderRow[] = [];
    let lastSection: SectionKey | null = null;
    let isFirst = true;

    // Count items per section for the header
    const sectionCounts = new Map<SectionKey, number>();
    for (const item of items) {
      const key = getSectionKey(item);
      sectionCounts.set(key, (sectionCounts.get(key) ?? 0) + 1);
    }

    items.forEach((item, idx) => {
      const section = getSectionKey(item);
      // Insert section header at every section transition
      if (section !== lastSection) {
        result.push({
          type: 'header',
          key: section,
          count: sectionCounts.get(section) ?? 0,
          first: isFirst,
        });
        isFirst = false;
        lastSection = section;
      }
      result.push({ type: 'item', item, itemIndex: idx });
    });
    return result;
  }, [items]);

  // Compute height of each row based on its content
  const rowHeights = useMemo(() => {
    return rows.map((row): number => {
      if (row.type === 'header') return row.first ? 2 : 3; // title + separator (+ marginTop if not first)
      const { item } = row;
      if (item.kind === 'session') {
        let h = 1; // title line
        if (item.conflictCount != null && item.conflictCount > 0) h++;
        if (vcsConfigured) h++; // PrBadge (badge or "(no PR)")
        return h;
      }
      if (item.kind === 'orphan-pr') return 2; // title + badge
      return 3; // review: title + badge + "by author"
    });
  }, [rows, vcsConfigured]);

  // Compute scroll window using actual row heights
  const { fullyVisibleRows, gap, aboveCount, belowCount } = useMemo(() => {
    // Total non-item lines: header + keybinds margin + keybind lines + optional legend
    const chromeLines =
      HEADER_LINES +
      1 +
      keybindLineCount +
      (vcsConfigured ? 1 + LEGEND_LINES : 0);
    const availableLines = termRows - chromeLines;
    const totalHeight = rowHeights.reduce((a, b) => a + b, 0);

    if (totalHeight <= availableLines) {
      return { fullyVisibleRows: rows, gap: 0, aboveCount: 0, belowCount: 0 };
    }

    // Reserve space for scroll indicators (↑/↓ more)
    const budget = availableLines - 2;

    // Estimate how many rows fit (from top) to get a maxVisible for centering
    let fitCount = 0;
    let fitHeight = 0;
    for (const height of rowHeights) {
      if (fitHeight + height > budget) break;
      fitHeight += height;
      fitCount++;
    }

    const selectedRowIdx = Math.max(
      0,
      rows.findIndex((r) => r.type === 'item' && r.itemIndex === selectedIndex)
    );

    // Use computeScrollWindow for centering, then verify with actual heights
    let start = computeScrollWindow({
      totalItems: rows.length,
      selectedIndex: selectedRowIdx,
      maxVisible: Math.max(1, fitCount),
    }).windowStart;

    // From start, greedily add rows that fully fit within budget
    const greedySlice = (from: number) => {
      let count = 0;
      let height = 0;
      for (let i = from; i < rows.length; i++) {
        if (height + rowHeights[i] > budget) break;
        height += rowHeights[i];
        count++;
      }
      return { count, height };
    };

    let { count: fullCount, height: usedHeight } = greedySlice(start);

    // If selected row fell outside the visible window (row heights vary),
    // slide the window forward until the selected row is included.
    while (selectedRowIdx >= start + fullCount && start < rows.length - 1) {
      start++;
      ({ count: fullCount, height: usedHeight } = greedySlice(start));
    }

    const gap = budget - usedHeight;
    const nextIdx = start + fullCount;

    return {
      fullyVisibleRows: rows.slice(start, start + fullCount),
      gap,
      aboveCount: start,
      belowCount: Math.max(0, rows.length - nextIdx),
    };
  }, [
    rows,
    rowHeights,
    selectedIndex,
    termRows,
    vcsConfigured,
    keybindLineCount,
  ]);

  const renderRow = (row: RenderRow) => {
    if (row.type === 'header') {
      const label = SECTION_LABELS[row.key];
      return (
        <SectionHeader
          key={`section-${row.key}`}
          title={label.title}
          color={label.color}
          count={row.count}
          innerWidth={innerWidth}
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
        />
      );
    }
    if (item.kind === 'orphan-pr') {
      return (
        <OrphanPrRow
          key={`o-${item.pr.id}`}
          pr={item.pr}
          selected={selected}
          sidebarWidth={sidebarWidth}
          running={item.running}
        />
      );
    }
    return (
      <ReviewPrRow
        key={`r-${item.pr.id}`}
        pr={item.pr}
        selected={selected}
        sidebarWidth={sidebarWidth}
        innerWidth={innerWidth}
        running={item.running}
      />
    );
  };

  return (
    <SidebarLayout
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
        vcsConfigured ? (
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
