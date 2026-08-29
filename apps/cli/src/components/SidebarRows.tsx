import { memo, useEffect, type ReactNode } from 'react';
import { Text, Box } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { AgentSession } from '@kirby/core';
import { useActivityStatus, useFlashPhase } from '@kirby/app-core';
import { noteSeen, remove as removeInactiveAlert, tabDigit } from '@kirby/core';
import { Divider } from './Divider.js';
import { PrBadge } from './PrBadge.js';
import { RainbowSpinner } from './RainbowSpinner.js';
import { rowIcon } from './sidebar-model.js';

// Leaf component that owns the "needs attention" flash cadence. The
// row's conflict/badge siblings don't reconcile on every phase flip,
// but the enclosing <Text wrap="truncate"> does re-measure at ~1.43Hz —
// Ink's truncation needs the whole string in one <Text>, so the flash
// can't be a pure sibling of the title text.
function FlashingTitle({
  children,
  bold,
}: {
  children: ReactNode;
  bold: boolean;
}) {
  const phase = useFlashPhase();
  return (
    <Text bold={bold} color={phase === 0 ? 'gray' : 'white'}>
      {children}
    </Text>
  );
}

export const SessionItemRow = memo(function SessionItemRow({
  session,
  selected,
  pr,
  sidebarWidth,
  isMerged,
  conflictCount,
  vcsConfigured,
  tabNumber,
}: {
  session: AgentSession;
  selected: boolean;
  pr: PullRequestInfo | undefined;
  sidebarWidth: number;
  isMerged: boolean;
  conflictCount: number | undefined;
  vcsConfigured: boolean;
  /** 1..10 if this session has a quick-switch tab; undefined otherwise. */
  tabNumber: number | undefined;
}) {
  const { icon, color: iconColor } = rowIcon(selected, session.running);

  const activity = useActivityStatus(session.name);
  const title = pr?.title || session.name;

  // The selected row is what the user is looking at, so ack any output
  // (poll while selected, plus a final ack on deselect) — that way the
  // row does not flash the moment it is deselected. Runs at 1Hz; flash
  // requires ACTIVITY_IDLE_MS (2s) of silence after data, so a single
  // missed tick at the tail can't make the flash appear for content
  // the user actually saw.
  useEffect(() => {
    if (!selected) return;
    noteSeen(session.name);
    // Visiting acks any pending inactive-alert: the user is here, they
    // don't need a queued jump back to a session they're already on.
    removeInactiveAlert(session.name);
    const id = setInterval(() => noteSeen(session.name), 1000);
    return () => {
      clearInterval(id);
      noteSeen(session.name);
    };
  }, [selected, session.name]);

  // Short-circuit animations for the selected row: the user can see it
  // live in the terminal pane, so the indicator would be visual noise.
  const showFlash = !selected && activity.flashing;
  const showSpinner = !selected && activity.active;

  return (
    <Box flexDirection="column">
      <Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate">
            {tabNumber != null ? (
              <Text color="cyan" bold>
                {tabDigit(tabNumber)}{' '}
              </Text>
            ) : null}
            <Text color={iconColor}>{icon} </Text>
            {showFlash ? (
              <FlashingTitle bold={selected}>{title}</FlashingTitle>
            ) : (
              <Text bold={selected}>{title}</Text>
            )}
            {isMerged ? (
              <Text dimColor color="green">
                {' '}
                merged
              </Text>
            ) : null}
            {session.state === 'rebasing' ? (
              <Text color="yellow"> rebasing</Text>
            ) : null}
          </Text>
        </Box>
        <Box flexShrink={0} marginLeft={1} width={1}>
          {showSpinner ? <RainbowSpinner /> : <Text> </Text>}
        </Box>
      </Box>
      {conflictCount != null && conflictCount > 0 ? (
        <Text dimColor color="yellow">
          {'  '}
          {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}
        </Text>
      ) : null}
      {vcsConfigured ? <PrBadge pr={pr} sidebarWidth={sidebarWidth} /> : null}
    </Box>
  );
});

/**
 * A pull request with no worktree of its own — either one Kirby knows
 * about but has not checked out, or one queued for review. The review
 * sections name the author under the badge; the plain PR sections do
 * not, which is the only thing that differs between them.
 */
export const PrItemRow = memo(function PrItemRow({
  pr,
  selected,
  sidebarWidth,
  running,
  author,
}: {
  pr: PullRequestInfo;
  selected: boolean;
  sidebarWidth: number;
  running?: boolean;
  author?: string;
}) {
  const { icon, color: iconColor } = rowIcon(selected, running);

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color={iconColor}>{icon} </Text>
        <Text bold={selected}>{pr.title || pr.sourceBranch}</Text>
      </Text>
      <PrBadge pr={pr} sidebarWidth={sidebarWidth} author={author} />
    </Box>
  );
});

export function SectionHeader({
  title,
  color,
  count,
  first,
}: {
  title: string;
  color: string;
  count: number;
  first: boolean;
}) {
  return (
    <Box marginTop={first ? 0 : 1}>
      <Divider
        title={`${title} (${count})`}
        titleColor={color}
        dividerColor="gray"
      />
    </Box>
  );
}
