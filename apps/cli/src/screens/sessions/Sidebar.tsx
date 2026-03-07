import { memo } from 'react';
import { Text, Box } from 'ink';
import type { AgentSession } from '../../types.js';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { PrBadge } from '../../components/PrBadge.js';
import { SidebarLayout } from '../../components/SidebarLayout.js';
import { truncate } from '../../utils/truncate.js';
import { useConfig } from '../../context/ConfigContext.js';

const SessionItem = memo(function SessionItem({
  session,
  selected,
  pr,
  sidebarWidth,
  isMerged,
  conflictCount,
  conflictsLoading,
}: {
  session: AgentSession;
  selected: boolean;
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
  sessionBranchMap,
  sessionPrMap,
  sidebarWidth,
  orphanPrs,
  mergedBranches,
  conflictCounts,
  conflictsLoading,
}: {
  sessions: AgentSession[];
  selectedIndex: number;
  focused: boolean;
  sessionBranchMap: Map<string, string>;
  sessionPrMap: Map<string, PullRequestInfo>;
  sidebarWidth: number;
  orphanPrs: PullRequestInfo[];
  mergedBranches: Set<string>;
  conflictCounts?: Map<string, number>;
  conflictsLoading?: boolean;
}) {
  const { vcsConfigured } = useConfig();
  const activeOrphanPrs = orphanPrs.filter((pr) => pr.isDraft !== true);
  const draftOrphanPrs = orphanPrs.filter((pr) => pr.isDraft === true);

  return (
    <SidebarLayout
      title="🌴 Worktree Sessions"
      focused={focused}
      sidebarWidth={sidebarWidth}
      emptyText="(no sessions)"
      isEmpty={sessions.length === 0}
      keybinds={
        <>
          <Text dimColor>
            <Text color="cyan">c</Text> checkout branch
          </Text>
          <Text dimColor>
            <Text color="cyan">d</Text> delete branch
          </Text>
          <Text dimColor>
            <Text color="cyan">shift+k</Text> kill agent
          </Text>
          <Text dimColor>
            <Text color="cyan">u</Text> rebase onto master
          </Text>
          <Text dimColor>
            <Text color="cyan">.</Text> open in editor
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
            <Text color="cyan">tab</Text> / <Text color="cyan">ctrl+space</Text>{' '}
            switch focus
          </Text>
          <Text dimColor>
            <Text color="cyan">s</Text> settings
          </Text>
          <Text dimColor>
            <Text color="cyan">q</Text> quit
          </Text>
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
      {sessions.map((s, i) => {
        const branch = sessionBranchMap.get(s.name);
        const isMerged = branch ? mergedBranches.has(branch) : false;
        return (
          <SessionItem
            key={s.name}
            session={s}
            selected={i === selectedIndex}
            pr={sessionPrMap.get(s.name)}
            sidebarWidth={sidebarWidth}
            isMerged={isMerged}
            conflictCount={branch ? conflictCounts?.get(branch) : undefined}
            conflictsLoading={!!conflictsLoading && !isMerged && !!branch}
          />
        );
      })}
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
    </SidebarLayout>
  );
}
