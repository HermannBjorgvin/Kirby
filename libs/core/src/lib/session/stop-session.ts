import { hasSession, killSession } from '../pty-registry.js';
import { killPersistedTmuxSession } from '../session-backend.js';

/** Stop the held target, or resolve a persisted target when no entry is held. */
export function stopSession(name: string): void {
  // Resolving again after killing a held target could select a different session
  // carrying the same identity tags. A stop operation owns exactly one target.
  if (hasSession(name)) killSession(name);
  else killPersistedTmuxSession(name);
}
