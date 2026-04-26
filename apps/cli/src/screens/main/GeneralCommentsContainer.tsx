import { useInput } from 'ink';
import { GeneralCommentsPane } from '../reviews/GeneralCommentsPane.js';
import { useSessionActions } from '../../context/SessionContext.js';
import { handleReplyModeInput } from '../../utils/reply-mode.js';
import type { TerminalLayout } from '../../context/LayoutContext.js';
import type { PaneModeValue } from '../../hooks/usePaneReducer.js';
import type { DiffBundle } from '../../hooks/useDiffBundle.js';

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
  const { flashStatus } = useSessionActions();
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
      const count = generalComments.length;
      if ((input === 'j' || key.downArrow) && count > 0) {
        pane.setGeneralCommentsIndex((i) => {
          const next = Math.min(i + 1, count - 1);
          pane.setGeneralCommentsScrollOffset((off) =>
            next >= off + viewportHeight ? next - viewportHeight + 1 : off
          );
          return next;
        });
        return;
      }
      if ((input === 'k' || key.upArrow) && count > 0) {
        pane.setGeneralCommentsIndex((i) => {
          const next = Math.max(i - 1, 0);
          pane.setGeneralCommentsScrollOffset((off) =>
            next < off ? next : off
          );
          return next;
        });
        return;
      }
      if (input === 'r' && count > 0) {
        const target = generalComments[pane.generalCommentsIndex];
        if (target) {
          pane.setReplyingToThreadId(target.id);
          pane.setReplyBuffer('');
        }
        return;
      }
      if (input === 'v' && count > 0) {
        const target = generalComments[pane.generalCommentsIndex];
        if (!target) return;
        const newResolved = !target.isResolved;
        flashStatus(
          newResolved ? 'Resolving thread...' : 'Reopening thread...'
        );
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
        return;
      }
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
