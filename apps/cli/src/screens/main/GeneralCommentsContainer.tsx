import { useInput } from 'ink';
import { GeneralCommentsPane } from '../reviews/GeneralCommentsPane.js';
import type {
  TerminalLayout,
  PaneModeValue,
  DiffBundle,
} from '@kirby/app-core';
import { useSessionActions } from '@kirby/app-core';
import { handleReplyModeInput } from '../../utils/reply-mode.js';

interface GeneralCommentsContainerProps {
  pane: PaneModeValue;
  terminal: TerminalLayout;
  terminalFocused: boolean;
  diffBundle: DiffBundle;
}

// Owns the 'comments' pane — lists PR-level (non-inline) comments fetched
// from the VCS provider. Navigation is simple: j/k to move selection, esc
// to return to pr-detail. The comments stream comes in via diffBundle so
// we reuse the single provider fetch started in MainContent.
export function GeneralCommentsContainer({
  pane,
  terminal,
  terminalFocused,
  diffBundle,
}: GeneralCommentsContainerProps) {
  const generalComments = diffBundle.remote.generalComments;
  const viewportHeight = Math.max(1, terminal.paneRows - 2);
  const count = generalComments.length;
  const { flashStatus } = useSessionActions();

  /** Move the cursor and keep it inside the viewport. */
  const moveSelection = (delta: 1 | -1) => {
    pane.setGeneralCommentsIndex((i) => {
      const next = Math.min(Math.max(i + delta, 0), count - 1);
      pane.setGeneralCommentsScrollOffset((off) => {
        if (next < off) return next;
        if (next >= off + viewportHeight) return next - viewportHeight + 1;
        return off;
      });
      return next;
    });
  };

  const startReply = () => {
    const target = generalComments[pane.generalCommentsIndex];
    if (!target) return;
    pane.setReplyingToThreadId(target.id);
    pane.setReplyBuffer('');
  };

  const toggleResolved = () => {
    const target = generalComments[pane.generalCommentsIndex];
    if (!target) return;
    const newResolved = !target.isResolved;
    flashStatus(newResolved ? 'Resolving thread...' : 'Reopening thread...');
    diffBundle.remote
      .toggleResolved(target.id, newResolved)
      .then((success) => {
        if (success) {
          flashStatus(newResolved ? 'Thread resolved' : 'Thread reopened');
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        flashStatus(`Failed: ${msg}`);
      });
  };

  useInput(
    (input, key) => {
      // Reply mode bypass (Esc/Enter/text) — see apps/cli/src/utils/reply-mode.ts
      if (
        handleReplyModeInput(input, key, {
          pane,
          flashStatus,
          replyToThread: diffBundle.remote.replyToThread,
        })
      ) {
        return;
      }

      if (key.escape) {
        pane.setPaneMode('pr-detail');
        return;
      }
      // Everything below acts on the selected thread, so an empty list
      // has nothing for them to do.
      if (count === 0) return;
      if (input === 'j' || key.downArrow) moveSelection(1);
      else if (input === 'k' || key.upArrow) moveSelection(-1);
      else if (input === 'r') startReply();
      else if (input === 'v') toggleResolved();
    },
    { isActive: !terminalFocused }
  );

  return (
    <GeneralCommentsPane
      comments={generalComments}
      selectedIndex={pane.generalCommentsIndex}
      scrollOffset={pane.generalCommentsScrollOffset}
      paneRows={terminal.paneRows}
      replyingToThreadId={pane.replyingToThreadId}
      replyBuffer={pane.replyBuffer}
    />
  );
}
