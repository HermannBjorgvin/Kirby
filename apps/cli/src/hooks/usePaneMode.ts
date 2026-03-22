import { useState } from 'react';
import type { PaneMode, SidebarItem } from '../types.js';
import { getPrFromItem } from '../types.js';
import { hasSession } from '../pty-registry.js';
import type { useDiffState } from './useDiffState.js';
import type { useCommentState } from './useCommentState.js';
import type { useReviewConfirmState } from './useReviewConfirmState.js';

/**
 * Compute the default pane mode for a given item.
 */
function defaultPaneMode(
  item: SidebarItem | undefined,
  sessionName: string | null,
  reviewSessionStarted: Set<number>
): PaneMode {
  if (!item) return 'terminal';
  if (sessionName && hasSession(sessionName)) return 'terminal';
  if (item.kind === 'review-pr' && reviewSessionStarted.has(item.pr.id)) {
    return 'terminal';
  }
  const pr = getPrFromItem(item);
  if (pr) return 'pr-detail';
  return 'terminal';
}

/**
 * The composite type returned when all pane hooks are combined.
 * Input handlers receive this shape — no changes needed downstream.
 */
export type PaneModeValue = ReturnType<typeof usePaneMode> &
  ReturnType<typeof useDiffState> &
  ReturnType<typeof useCommentState> &
  ReturnType<typeof useReviewConfirmState>;

/**
 * Manages the right-pane mode and session tracking.
 *
 * Auto-resets pane mode when the selected item changes:
 * - Running PTY session → 'terminal'
 * - Item with PR, no session → 'pr-detail'
 * - Item without PR, no session → 'terminal' (empty state)
 */
export function usePaneMode(
  selectedItem: SidebarItem | undefined,
  sessionNameForTerminal: string | null
) {
  const [paneMode, setPaneMode] = useState<PaneMode>('terminal');
  const [reconnectKey, setReconnectKey] = useState(0);
  const [reviewSessionStarted, setReviewSessionStarted] = useState<Set<number>>(
    new Set()
  );

  // Auto-reset pane mode when selected item changes.
  // Uses the React "store previous value" pattern to detect prop changes
  // during render — no useEffect needed.
  const itemKey = selectedItem
    ? selectedItem.kind === 'session'
      ? `session:${selectedItem.session.name}`
      : `pr:${selectedItem.pr.id}`
    : null;

  const [prevItemKey, setPrevItemKey] = useState<string | null>(null);
  if (itemKey !== prevItemKey) {
    setPrevItemKey(itemKey);
    const target = defaultPaneMode(
      selectedItem,
      sessionNameForTerminal,
      reviewSessionStarted
    );
    if (target !== paneMode) {
      setPaneMode(target);
    }
  }

  return {
    paneMode,
    setPaneMode,
    reconnectKey,
    setReconnectKey,
    reviewSessionStarted,
    setReviewSessionStarted,
  };
}
