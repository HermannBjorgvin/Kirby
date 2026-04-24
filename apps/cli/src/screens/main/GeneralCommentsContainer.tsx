import { useInput } from 'ink';
import { GeneralCommentsPane } from '../reviews/GeneralCommentsPane.js';
import { useSessionActions } from '../../context/SessionContext.js';
import { handleTextInput } from '../../utils/handle-text-input.js';
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
  const replyingThread = pane.replyingToThreadId
    ? generalComments.find((t) => t.id === pane.replyingToThreadId)
    : undefined;

  useInput(
    (input, key) => {
      // ── Reply mode (exempt from normal navigation) ──
      if (replyingThread) {
        if (key.escape) {
          pane.setReplyingToThreadId(null);
          pane.setReplyBuffer('');
          return;
        }
        if (key.return) {
          const threadId = replyingThread.id;
          const body = pane.replyBuffer.trim();
          if (body) {
            flashStatus('Posting reply...');
            diffBundle.remote
              .replyToThread(threadId, body)
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
          return;
        }
        handleTextInput(input, key, pane.setReplyBuffer);
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
