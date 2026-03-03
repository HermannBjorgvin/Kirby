import { useState } from 'react';
import { usePtySession } from './usePtySession.js';
import { useRawStdinForward } from './useRawStdinForward.js';

/**
 * Combines PTY session management, raw stdin forwarding, and content state
 * into a single hook. Each tab (sessions, reviews) uses one instance.
 */
export function useTerminal(
  sessionName: string | null,
  cols: number,
  rows: number,
  reconnectKey: number,
  active: boolean,
  onEscape: () => void
) {
  const [content, setContent] = useState('(loading...)');

  const { write, mouseMode, scrollUp, scrollDown } = usePtySession(
    sessionName,
    cols,
    rows,
    setContent,
    reconnectKey
  );

  useRawStdinForward(active, write, onEscape, mouseMode, scrollUp, scrollDown);

  return { content };
}
