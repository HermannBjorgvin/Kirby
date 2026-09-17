import { TerminalView } from '../../components/TerminalView.js';
import type { TerminalLayout } from '@n10/app-core';
import { useTerminal } from '../../hooks/useTerminal.js';

interface TerminalPaneProps {
  sessionNameForTerminal: string | null;
  terminal: TerminalLayout;
  reconnectKey: number;
  terminalFocused: boolean;
  onFocusSidebar: () => void;
}

export function TerminalPane({
  sessionNameForTerminal,
  terminal,
  reconnectKey,
  terminalFocused,
  onFocusSidebar,
}: TerminalPaneProps) {
  const { content } = useTerminal(
    sessionNameForTerminal,
    terminal.paneCols,
    terminal.paneRows,
    reconnectKey,
    terminalFocused,
    onFocusSidebar
  );

  return <TerminalView content={content} />;
}
