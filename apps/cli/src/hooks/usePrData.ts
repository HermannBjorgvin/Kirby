import { useState, useEffect, useRef, useCallback } from 'react';
import type { BranchPrMap } from '@kirby/vcs-core';
import { logError } from '@kirby/logger';
import { useConfig } from '../context/ConfigContext.js';
import { useToastActions } from '../context/ToastContext.js';

export function usePrData(refreshInterval = 60000) {
  const { config, provider } = useConfig();
  const { flash } = useToastActions();
  const { vendorAuth, vendorProject, prPollInterval } = config;
  const [prMap, setPrMap] = useState<BranchPrMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // Track the last error message we surfaced as a toast so that polling
  // doesn't re-flash the same error every interval. Flash fires once on
  // any new distinct error, and re-fires only when the message changes.
  const lastFlashedErrorRef = useRef<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!provider || !provider.isConfigured(vendorAuth, vendorProject)) return;
    setLoading(true);
    try {
      const map = await provider.fetchPullRequests(vendorAuth, vendorProject);
      if (mountedRef.current) {
        setPrMap(map);
        setError(null);
        lastFlashedErrorRef.current = null;
      }
    } catch (err: unknown) {
      const error = err as Error;
      logError(`fetchPullRequests [${provider.id}]`, error);
      if (mountedRef.current) {
        setError(error.message);
        if (lastFlashedErrorRef.current !== error.message) {
          lastFlashedErrorRef.current = error.message;
          flash(`PR error: ${error.message}`, 'error');
        }
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [vendorAuth, vendorProject, provider, flash]);

  useEffect(() => {
    mountedRef.current = true;
    if (!provider || !provider.isConfigured(vendorAuth, vendorProject)) return;
    // Fire and forget — the initial fetch happens on mount. `refresh`
    // now returns a promise, but we don't need to await it here; the
    // state updates inside it are mount-guarded by `mountedRef`.
    void refresh();
    const interval = setInterval(refresh, prPollInterval ?? refreshInterval);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [
    vendorAuth,
    vendorProject,
    prPollInterval,
    provider,
    refresh,
    refreshInterval,
  ]);

  return { prMap, loading, error, refresh };
}
