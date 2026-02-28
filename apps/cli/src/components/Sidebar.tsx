import { Text, Box } from 'ink';
import { branchToSessionName } from '@kirby/tmux-manager';
import type { TmuxSession } from '@kirby/tmux-manager';
import type { BranchPrMap, PullRequestInfo } from '@kirby/shared-types';
import { PrBadge } from './PrBadge.js';

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

function prUrl(baseUrl: string | undefined, prId: number): string | undefined {
  return baseUrl ? `${baseUrl}/pullrequest/${prId}` : undefined;
}

function OrphanPrSection({
  title,
  prs,
  startIndex,
  selectedIndex,
  focused,
  innerWidth,
  prBaseUrl,
  sidebarWidth,
}: {
  title: string;
  prs: PullRequestInfo[];
  startIndex: number;
  selectedIndex: number;
  focused: boolean;
  innerWidth: number;
  prBaseUrl?: string;
  sidebarWidth: number;
}) {
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
          <Box key={pr.pullRequestId} flexDirection="column">
            <Text>
              <Text color={selected ? 'cyan' : undefined}>
                {selected ? '› ' : '  '}
              </Text>
              <Text bold={selected}>{truncate(pr.sourceBranch, 42)}</Text>
            </Text>
            <PrBadge
              pr={pr}
              url={prUrl(prBaseUrl, pr.pullRequestId)}
              sidebarWidth={sidebarWidth}
            />
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
  adoConfigured,
  sidebarWidth,
  orphanPrs,
  prBaseUrl,
}: {
  sessions: TmuxSession[];
  selectedIndex: number;
  focused: boolean;
  prMap: BranchPrMap;
  adoConfigured: boolean;
  sidebarWidth: number;
  orphanPrs: PullRequestInfo[];
  prBaseUrl?: string;
}) {
  const innerWidth = Math.max(10, sidebarWidth - 2);
  const activeOrphanPrs = orphanPrs.filter((pr) => !pr.isDraft);
  const draftOrphanPrs = orphanPrs.filter((pr) => pr.isDraft);

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
          const selected = i === selectedIndex;
          const icon = s.windows > 0 ? '●' : '○';
          const color = s.windows > 0 ? 'green' : 'gray';
          const branch = Object.keys(prMap).find(
            (b) => branchToSessionName(b) === s.name
          );
          const pr = branch ? prMap[branch] : undefined;
          return (
            <Box key={s.name} flexDirection="column">
              <Text>
                <Text color={selected ? 'cyan' : undefined}>
                  {selected ? '› ' : '  '}
                </Text>
                <Text color={color}>{icon} </Text>
                <Text bold={selected}>{truncate(s.name, 42)}</Text>
              </Text>
              {adoConfigured ? (
                <PrBadge
                  pr={pr}
                  url={pr ? prUrl(prBaseUrl, pr.pullRequestId) : undefined}
                  sidebarWidth={sidebarWidth}
                />
              ) : null}
            </Box>
          );
        })
      )}
      <OrphanPrSection
        title="🎪 Pull Requests"
        prs={activeOrphanPrs}
        startIndex={sessions.length}
        selectedIndex={selectedIndex}
        focused={focused}
        innerWidth={innerWidth}
        prBaseUrl={prBaseUrl}
        sidebarWidth={sidebarWidth}
      />
      <OrphanPrSection
        title="✍️ Draft Pull Requests"
        prs={draftOrphanPrs}
        startIndex={sessions.length + activeOrphanPrs.length}
        selectedIndex={selectedIndex}
        focused={focused}
        innerWidth={innerWidth}
        prBaseUrl={prBaseUrl}
        sidebarWidth={sidebarWidth}
      />
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
    </Box>
  );
}
