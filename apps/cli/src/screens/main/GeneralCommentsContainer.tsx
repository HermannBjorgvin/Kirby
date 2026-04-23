import { useInput } from 'ink';
import { GeneralCommentsPane } from '../reviews/GeneralCommentsPane.js';
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

  useInput(
    (input, key) => {
      if (key.escape) {
        pane.setPaneMode('pr-detail');
        return;
      }
      const count = generalComments.length;
      if ((input === 'j' || key.downArrow) && count > 0) {
        pane.setGeneralCommentsIndex((i) => Math.min(i + 1, count - 1));
        return;
      }
      if ((input === 'k' || key.upArrow) && count > 0) {
        pane.setGeneralCommentsIndex((i) => Math.max(i - 1, 0));
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
    />
  );
}
