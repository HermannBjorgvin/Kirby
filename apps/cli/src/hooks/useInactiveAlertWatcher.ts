import { useEffect, useLayoutEffect, useRef } from 'react';
import { snapshot } from '../activity.js';
import { enqueue as enqueueAlert } from '../inactive-alerts.js';
import { useToastActions } from '../context/ToastContext.js';
import { useConfig } from '../context/ConfigContext.js';
import { useSessionData } from '../context/SessionContext.js';

const POLL_MS = 250;

/**
 * Watches every running session's activity state and fires an info
 * toast + enqueues the session name into the inactive-alerts queue
 * when it transitions active → idle. Mount once at app level.
 *
 * The currently-viewed session is suppressed — the user is already
 * looking at it, so they don't need a toast or a queued jump.
 *
 * Off-screen sidebar rows aren't mounted, so a per-row detector would
 * miss transitions for sessions the user hasn't scrolled to. This hook
 * iterates the SessionContext's full list, so every running session is
 * tracked regardless of sidebar visibility.
 */
export function useInactiveAlertWatcher(currentlyViewed: string | null): void {
  const { sessions } = useSessionData();
  const { flash } = useToastActions();
  const { config } = useConfig();

  const sessionsRef = useRef(sessions);
  const viewedRef = useRef(currentlyViewed);
  const jumpEnabledRef = useRef(config.jumpToInactiveOnEscape !== false);
  const prevActive = useRef<Map<string, boolean>>(new Map());

  useLayoutEffect(() => {
    sessionsRef.current = sessions;
    viewedRef.current = currentlyViewed;
    jumpEnabledRef.current = config.jumpToInactiveOnEscape !== false;
  });

  useEffect(() => {
    const id = setInterval(() => {
      const prev = prevActive.current;
      const next = new Map<string, boolean>();
      for (const s of sessionsRef.current) {
        const cur = snapshot(s.name).active;
        next.set(s.name, cur);
        const wasActive = prev.get(s.name) === true;
        if (wasActive && !cur && s.name !== viewedRef.current) {
          flash(`${s.name} is idle`, 'info');
          if (jumpEnabledRef.current) enqueueAlert(s.name);
        }
      }
      prevActive.current = next;
    }, POLL_MS);
    return () => clearInterval(id);
  }, [flash]);
}
