import { Text, Box } from 'ink';
import { branchToSessionName } from '@kirby/tmux-manager';
import type { TmuxSession } from '@kirby/tmux-manager';
import type { BranchPrMap, PullRequestInfo } from '@kirby/vcs-core';
import { PrBadge } from './PrBadge.js';
import { useConflictCount } from '../hooks/useConflictCount.js';
import { truncate } from '../utils/truncate.js';

function SessionItem({
  session,
  selected,
  prMap,
  vcsConfigured,
  sidebarWidth,
  isMerged,
  lastSynced,
}: {
  session: TmuxSession;
  selected: boolean;
  prMap: BranchPrMap;
  vcsConfigured: boolean;
  sidebarWidth: number;
  isMerged: boolean;
  lastSynced: number;
}) {
  const icon = session.windows > 0 ? '●' : '○';
  const color = session.windows > 0 ? 'green' : 'gray';
  const branch = Object.keys(prMap).find(
    (b) => branchToSessionName(b) === session.name
  );
  const pr = branch ? prMap[branch] : undefined;
  const { count: conflicts, loading: conflictsLoading } = useConflictCount(
    branch ?? '',
    isMerged ? 0 : lastSynced
  );

  return (
    <Box key={session.name} flexDirection="column">
      <Text>
        <Text color={selected ? 'cyan' : undefined}>
          {selected ? '› ' : '  '}
        </Text>
        <Text color={color}>{icon} </Text>
        <Text bold={selected}>{truncate(session.name, 42)}</Text>
        {isMerged ? (
          <Text dimColor color="green">
            {' '}
            merged
          </Text>
        ) : null}
      </Text>
      {conflicts != null && conflicts > 0 ? (
        <Text dimColor color="yellow">
          {'    '}
          {conflicts} conflict{conflicts !== 1 ? 's' : ''}
        </Text>
      ) : null}
      {conflictsLoading ? <Text dimColor>{'    '}checking...</Text> : null}
      {vcsConfigured ? <PrBadge pr={pr} sidebarWidth={sidebarWidth} /> : null}
    </Box>
  );
}

function OrphanPrSection({
  title,
  prs,
  startIndex,
  selectedIndex,
  focused,
  sidebarWidth,
}: {
  title: string;
  prs: PullRequestInfo[];
  startIndex: number;
  selectedIndex: number;
  focused: boolean;
  sidebarWidth: number;
}) {
  const innerWidth = Math.max(10, sidebarWidth - 2);
  if (prs.length === 0) return null;
  return (
    <>
      <Box marginTop={1}>
        <Text bold color={focused ? 'blue' : 'gray'}>
          {title}
        </Text>
      </Box>
      <Text dimColor>{'─'.repeat(innerWidth)}</Text>
      {prs.map((pr, i) => {
        const selected = startIndex + i === selectedIndex;
        return (
          <Box key={pr.id} flexDirection="column">
            <Text>
              <Text color={selected ? 'cyan' : undefined}>
                {selected ? '› ' : '  '}
              </Text>
              <Text bold={selected}>{truncate(pr.sourceBranch, 42)}</Text>
            </Text>
            <PrBadge pr={pr} sidebarWidth={sidebarWidth} />
          </Box>
        );
      })}
    </>
  );
}

export function Sidebar({
  sessions,
  selectedIndex,
  focused,
  prMap,
  vcsConfigured,
  sidebarWidth,
  orphanPrs,
  mergedBranches,
  lastSynced,
}: {
  sessions: TmuxSession[];
  selectedIndex: number;
  focused: boolean;
  prMap: BranchPrMap;
  vcsConfigured: boolean;
  sidebarWidth: number;
  orphanPrs: PullRequestInfo[];
  mergedBranches: Set<string>;
  lastSynced: number;
}) {
  const innerWidth = Math.max(10, sidebarWidth - 2);
  const activeOrphanPrs = orphanPrs.filter((pr) => pr.isDraft !== true);
  const draftOrphanPrs = orphanPrs.filter((pr) => pr.isDraft === true);

  return (
    <Box flexDirection="column" width={sidebarWidth} paddingX={1}>
      <Text bold color={focused ? 'blue' : 'gray'}>
        🌴 Worktree Sessions
      </Text>
      <Text dimColor>{'─'.repeat(innerWidth)}</Text>
      {sessions.length === 0 ? (
        <Text dimColor>(no sessions)</Text>
      ) : (
        sessions.map((s, i) => {
          const branch = Object.keys(prMap).find(
            (b) => branchToSessionName(b) === s.name
          );
          const isMerged = branch ? mergedBranches.has(branch) : false;
          return (
            <SessionItem
              key={s.name}
              session={s}
              selected={i === selectedIndex}
              prMap={prMap}
              vcsConfigured={vcsConfigured}
              sidebarWidth={sidebarWidth}
              isMerged={isMerged}
              lastSynced={lastSynced}
            />
          );
        })
      )}
      {vcsConfigured ? (
        <>
          <OrphanPrSection
            title="🎪 Pull Requests"
            prs={activeOrphanPrs}
            startIndex={sessions.length}
            selectedIndex={selectedIndex}
            focused={focused}
            sidebarWidth={sidebarWidth}
          />
          <OrphanPrSection
            title="✍️ Draft Pull Requests"
            prs={draftOrphanPrs}
            startIndex={sessions.length + activeOrphanPrs.length}
            selectedIndex={selectedIndex}
            focused={focused}
            sidebarWidth={sidebarWidth}
          />
        </>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          <Text color="cyan">c</Text> checkout branch
        </Text>
        <Text dimColor>
          <Text color="cyan">d</Text> delete branch
        </Text>
        <Text dimColor>
          <Text color="cyan">shift+k</Text> kill tmux session
        </Text>
        <Text dimColor>
          <Text color="cyan">u</Text> rebase onto master
        </Text>
        {vcsConfigured ? (
          <>
            <Text dimColor>
              <Text color="cyan">r</Text> refresh PR data
            </Text>
            <Text dimColor>
              <Text color="cyan">g</Text> sync with origin
            </Text>
          </>
        ) : null}
        <Text dimColor>
          <Text color="cyan">tab</Text> switch focus
        </Text>
        <Text dimColor>
          <Text color="cyan">s</Text> settings
        </Text>
        <Text dimColor>
          <Text color="cyan">q</Text> quit
        </Text>
      </Box>
      {vcsConfigured ? (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>🔧✅ passed 🔧🔥 failed 🔧⏳ pending</Text>
          <Text dimColor>🔔 needs attention ⭐ fully approved</Text>
        </Box>
      ) : null}
    </Box>
  );
}
