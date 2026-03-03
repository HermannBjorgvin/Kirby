import { memo } from 'react';
import { Text, Box } from 'ink';
import type { AgentSession } from '@kirby/worktree-manager';
import type { BranchPrMap, PullRequestInfo } from '@kirby/vcs-core';
import { PrBadge } from './PrBadge.js';
import { truncate } from '../utils/truncate.js';
import { useConfig } from '../context/ConfigContext.js';

const SessionItem = memo(function SessionItem({
  session,
  selected,
  branch,
  pr,
  sidebarWidth,
  isMerged,
  conflictCount,
  conflictsLoading,
}: {
  session: AgentSession;
  selected: boolean;
  branch: string | undefined;
  pr: PullRequestInfo | undefined;
  sidebarWidth: number;
  isMerged: boolean;
  conflictCount: number | undefined;
  conflictsLoading: boolean;
}) {
  const { vcsConfigured } = useConfig();
  const icon = session.running ? '●' : '○';
  const color = session.running ? 'green' : 'gray';

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
      {conflictCount != null && conflictCount > 0 ? (
        <Text dimColor color="yellow">
          {'    '}
          {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}
        </Text>
      ) : null}
      {conflictsLoading ? <Text dimColor>{'    '}checking...</Text> : null}
      {vcsConfigured ? <PrBadge pr={pr} sidebarWidth={sidebarWidth} /> : null}
    </Box>
  );
});

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
  sessionBranchMap,
  sessionPrMap,
  sidebarWidth,
  orphanPrs,
  mergedBranches,
  lastSynced,
  conflictCounts,
  conflictsLoading,
}: {
  sessions: AgentSession[];
  selectedIndex: number;
  focused: boolean;
  prMap: BranchPrMap;
  sessionBranchMap: Map<string, string>;
  sessionPrMap: Map<string, PullRequestInfo>;
  sidebarWidth: number;
  orphanPrs: PullRequestInfo[];
  mergedBranches: Set<string>;
  lastSynced: number;
  conflictCounts?: Map<string, number>;
  conflictsLoading?: boolean;
}) {
  const { vcsConfigured } = useConfig();
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
          const branch = sessionBranchMap.get(s.name);
          const isMerged = branch ? mergedBranches.has(branch) : false;
          return (
            <SessionItem
              key={s.name}
              session={s}
              selected={i === selectedIndex}
              branch={branch}
              pr={sessionPrMap.get(s.name)}
              sidebarWidth={sidebarWidth}
              isMerged={isMerged}
              conflictCount={branch ? conflictCounts?.get(branch) : undefined}
              conflictsLoading={!!conflictsLoading && !isMerged && !!branch}
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
