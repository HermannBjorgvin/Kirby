import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchRemote, fastForwardMaster } from '@kirby/worktree-manager';
import { useConfig } from '../context/ConfigContext.js';
import { logError } from '../log.js';

const DEFAULT_POLL_MS = 3_600_000; // 1 hour
const MIN_POLL_MS = 300_000; // 5 minutes

export function useRemoteSync() {
  const { vcsConfigured, config } = useConfig();
  const { mergePollInterval } = config;
  const [lastSynced, setLastSynced] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const mountedRef = useRef(true);

  const sync = useCallback(async () => {
    if (!vcsConfigured) return;
    setIsSyncing(true);
    try {
      await fetchRemote();
      await fastForwardMaster();
      if (mountedRef.current) setLastSynced(Date.now());
    } catch (err: unknown) {
      logError('useRemoteSync', err);
    } finally {
      if (mountedRef.current) setIsSyncing(false);
    }
  }, [vcsConfigured]);

  useEffect(() => {
    mountedRef.current = true;
    if (!vcsConfigured) return;

    sync();

    const interval = Math.max(
      MIN_POLL_MS,
      mergePollInterval ?? DEFAULT_POLL_MS
    );
    const timer = setInterval(sync, interval);

    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [vcsConfigured, mergePollInterval, sync]);

  return { lastSynced, isSyncing, triggerSync: sync };
}
