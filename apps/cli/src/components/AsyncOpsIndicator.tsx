import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { useAsyncOps } from '../context/AsyncOpsContext.js';
import type { OperationName } from '../hooks/useAsyncOperation.js';

// Human-readable labels for each async operation. Falls back to the
// raw op name if an entry is missing — keeps us from crashing on a
// new op that forgot its label.
const OP_LABELS: Partial<Record<OperationName, string>> = {
  sync: 'Syncing with origin',
  rebase: 'Rebasing',
  'fetch-branches': 'Fetching branches',
  'create-worktree': 'Creating session',
  delete: 'Deleting session',
  'check-delete': 'Checking session',
  'start-session': 'Starting agent',
  'open-editor': 'Opening editor',
  'refresh-pr': 'Refreshing PRs',
  'post-comment': 'Posting comment',
  'load-pr-files': 'Loading PR files',
};

// Width reservation for the spinner + label. Roughly enough for the
// longest op name list we expect (e.g. "sync, rebase, fetch-branches").
const INDICATOR_WIDTH = 40;

// Margin-free async-ops content: the label + spinner row, or null when
// idle. Positioning is owned by TopRightOverlay, which stacks this above
// the plan indicator and toasts in a single top-right column. Shown
// while any async operations are in flight; the label (comma-separated
// op names) says what's loading.
export function AsyncOpsContent() {
  const asyncOps = useAsyncOps();
  if (asyncOps.inFlight.size === 0) return null;

  const label = [...asyncOps.inFlight]
    .map((op) => OP_LABELS[op] ?? op)
    .join(', ');

  return (
    <Box width={INDICATOR_WIDTH} justifyContent="flex-end" gap={1}>
      <Text>{label}</Text>
      <Spinner />
    </Box>
  );
}
