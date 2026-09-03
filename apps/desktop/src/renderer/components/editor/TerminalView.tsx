import type { TerminalTab } from '../../lib/tabs/tabs.js';
import { useTerminals } from '../../lib/data/queries.js';
import { SessionTerminal } from '../terminal/SessionTerminal.js';

/**
 * A terminal tab's pane: the terminal, and nothing else. No rail, no
 * pull request bar, no diff — a shell in a folder has none of those.
 *
 * `epoch` is the session's spawn time from the host's listing, which is
 * what makes the pane re-fit when the process behind the name changes.
 */
export function TerminalView({
  tab,
  active,
}: {
  tab: TerminalTab;
  active: boolean;
}) {
  const terminals = useTerminals();
  const epoch =
    terminals.data?.find((t) => t.name === tab.name)?.spawnedAt ?? 0;
  return (
    <div className="relative min-h-0 flex-1" data-terminal-pane>
      <SessionTerminal name={tab.name} epoch={epoch} active={active} />
    </div>
  );
}
