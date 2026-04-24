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
    if (body) {
      flashStatus('Posting reply...');
      replyToThread(threadId, body)
        .then(() => {
          pane.setReplyingToThreadId(null);
          pane.setReplyBuffer('');
          flashStatus('Reply posted');
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          flashStatus(`Reply failed: ${msg}`);
        });
    }
    return true;
  }

  handleTextInput(input, key, pane.setReplyBuffer);
  return true;
}
