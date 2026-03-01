import { useState, useEffect, useRef, useCallback } from 'react';
import type { AppConfig, VcsProvider } from '@kirby/vcs-core';
import { isVcsConfigured } from '@kirby/vcs-core';
import { fetchRemote, fastForwardMaster } from '@kirby/tmux-manager';
import { logError } from '../log.js';

const DEFAULT_POLL_MS = 3_600_000; // 1 hour
const MIN_POLL_MS = 300_000; // 5 minutes

export function useRemoteSync(config: AppConfig, provider: VcsProvider | null) {
  const [lastSynced, setLastSynced] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const mountedRef = useRef(true);

  const sync = useCallback(async () => {
    if (!provider || !isVcsConfigured(config, provider)) return;
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
  }, [config, provider]);

  useEffect(() => {
    mountedRef.current = true;
    if (!provider || !isVcsConfigured(config, provider)) return;

    sync();

    const interval = Math.max(
      MIN_POLL_MS,
      config.mergePollInterval ?? DEFAULT_POLL_MS
    );
    const timer = setInterval(sync, interval);

    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [config, provider, sync]);

  return { lastSynced, isSyncing, triggerSync: sync };
}
