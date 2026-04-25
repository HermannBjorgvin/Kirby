import type { Key } from 'ink';
import type { RemoteCommentReply } from '@kirby/vcs-core';
import { handleTextInput } from './handle-text-input.js';

// Shared reply-mode input handling.
//
// Three surfaces (diff-viewer, diff-file-list, Shift+C pane) all
// host the same reply affordance: Esc cancels, Enter posts, any
// other key appends to the buffer. Factoring it into one helper
// keeps the post-success / failure flashStatus contract identical
// everywhere — no regression where one surface clears state on
// error and another doesn't.

// Module-local set of thread ids with an in-flight reply mutation.
// Two race conditions this guards against:
//   1. Double-Enter: hitting Enter twice before the first request
//      resolves used to fire the mutation twice and post duplicate
//      replies.
//   2. Stale resolution: when a post for thread A resolves, the
//      success handler used to unconditionally clear the pane's
//      reply state — which would clobber a fresh reply mode the
//      user may have entered for thread B.
const inFlightReplies = new Set<string>();

export interface ReplyModePane {
  replyingToThreadId: string | null;
  replyBuffer: string;
  setReplyingToThreadId: (id: string | null) => void;
  setReplyBuffer: (next: string | ((prev: string) => string)) => void;
}

export interface ReplyModeDeps {
  pane: ReplyModePane;
  flashStatus: (msg: string) => void;
  replyToThread: (
    threadId: string,
    body: string
  ) => Promise<RemoteCommentReply>;
}

/**
 * Returns `true` when the input was consumed by reply mode (caller
 * should return without running its normal action-dispatch pipeline).
 * Returns `false` when reply mode isn't active — caller proceeds as
 * usual.
 */
export function handleReplyModeInput(
  input: string,
  key: Key,
  deps: ReplyModeDeps
): boolean {
  const { pane, flashStatus, replyToThread } = deps;
  if (!pane.replyingToThreadId) return false;

  if (key.escape) {
    pane.setReplyingToThreadId(null);
    pane.setReplyBuffer('');
    return true;
  }

  if (key.return) {
    const threadId = pane.replyingToThreadId;
    const body = pane.replyBuffer.trim();
    if (body && !inFlightReplies.has(threadId)) {
      inFlightReplies.add(threadId);
      flashStatus('Posting reply...');
      replyToThread(threadId, body)
        .then(() => {
          // Only clear pane state if the user is still in reply mode
          // for this same thread — they may have hit Esc and started a
          // fresh reply on a different thread while we were posting.
          if (pane.replyingToThreadId === threadId) {
            pane.setReplyingToThreadId(null);
            pane.setReplyBuffer('');
          }
          flashStatus('Reply posted');
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          flashStatus(`Reply failed: ${msg}`);
        })
        .finally(() => {
          inFlightReplies.delete(threadId);
        });
    }
    return true;
  }

  handleTextInput(input, key, pane.setReplyBuffer);
  return true;
}
