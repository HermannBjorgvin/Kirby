import { useCallback } from 'react';
import { fetchRemote, fastForwardMainBranch } from '@kirby/worktree-manager';
import { logError } from '@kirby/logger';
import { useConfig } from '../context/ConfigContext.js';
import { usePolling } from './usePolling.js';

const DEFAULT_POLL_MS = 3_600_000; // 1 hour
const MIN_POLL_MS = 300_000; // 5 minutes

export function useRemoteSync() {
  const { vcsConfigured, config } = useConfig();
  const { mergePollInterval } = config;

  const interval = Math.max(MIN_POLL_MS, mergePollInterval ?? DEFAULT_POLL_MS);

  const sync = useCallback(async (): Promise<number> => {
    try {
      await fetchRemote();
      await fastForwardMainBranch();
    } catch (err: unknown) {
      logError('useRemoteSync', err);
    }
    return Date.now();
  }, []);

  const polling = usePolling<number>(sync, interval, vcsConfigured);

  return {
    lastSynced: polling.value ?? 0,
    isSyncing: polling.loading,
    triggerSync: polling.refresh,
  };
}
