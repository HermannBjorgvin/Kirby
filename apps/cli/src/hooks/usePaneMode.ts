import { useState, useRef } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { PaneMode, SidebarItem } from '../types.js';
import { hasSession } from '../pty-registry.js';

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
  if (
    item.kind === 'review-pr' &&
    reviewSessionStarted.has(item.pr.id)
  ) {
    return 'terminal';
  }
  const pr = item.kind === 'session' ? item.pr : item.pr;
  if (pr) return 'pr-detail';
  return 'terminal';
}

/**
 * Manages the right-pane mode and all review/diff state.
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

  // ── Diff viewer state ──
  const [diffFileIndex, setDiffFileIndex] = useState(0);
  const [diffViewFile, setDiffViewFile] = useState<string | null>(null);
  const [diffScrollOffset, setDiffScrollOffset] = useState(0);
  const [showSkipped, setShowSkipped] = useState(false);

  // ── Comment state ──
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(
    null
  );
  const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<
    string | null
  >(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');

  // ── Confirm dialog state ──
  const [reviewConfirm, setReviewConfirm] = useState<{
    pr: PullRequestInfo;
    selectedOption: number;
  } | null>(null);
  const [reviewInstruction, setReviewInstruction] = useState('');

  // ── Session tracking ──
  const [reviewSessionStarted, setReviewSessionStarted] = useState<
    Set<number>
  >(new Set());
  const [reconnectKey, setReconnectKey] = useState(0);

  // ── Auto-reset pane mode on item change ──
  // Track the item key as a ref. When the key changes, we compute the new
  // default pane mode and return that — then schedule a state update so
  // subsequent renders use the correct state value.
  const prevItemKeyRef = useRef<string | null>(null);
  const itemKey = selectedItem
    ? selectedItem.kind === 'session'
      ? `session:${selectedItem.session.name}`
      : `pr:${selectedItem.pr.id}`
    : null;

  let effectivePaneMode = paneMode;
  if (itemKey !== prevItemKeyRef.current) {
    prevItemKeyRef.current = itemKey;
    effectivePaneMode = defaultPaneMode(
      selectedItem,
      sessionNameForTerminal,
      reviewSessionStarted
    );
    // Update state to match (will cause one more render but avoids lint issues)
    if (effectivePaneMode !== paneMode) {
      // Use queueMicrotask to avoid setState during render
      queueMicrotask(() => setPaneMode(effectivePaneMode));
    }
  }

  return {
    paneMode: effectivePaneMode,
    setPaneMode,
    diffFileIndex,
    setDiffFileIndex,
    diffViewFile,
    setDiffViewFile,
    diffScrollOffset,
    setDiffScrollOffset,
    showSkipped,
    setShowSkipped,
    selectedCommentId,
    setSelectedCommentId,
    pendingDeleteCommentId,
    setPendingDeleteCommentId,
    editingCommentId,
    setEditingCommentId,
    editBuffer,
    setEditBuffer,
    reviewConfirm,
    setReviewConfirm,
    reviewInstruction,
    setReviewInstruction,
    reviewSessionStarted,
    setReviewSessionStarted,
    reconnectKey,
    setReconnectKey,
  };
}
