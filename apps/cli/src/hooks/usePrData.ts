import { useState, useEffect, useRef, useCallback } from 'react';
import type { BranchPrMap } from '@kirby/vcs-core';
import { logError } from '@kirby/logger';
import { useConfig } from '../context/ConfigContext.js';

export function usePrData(refreshInterval = 60000) {
  const { config, provider } = useConfig();
  const { vendorAuth, vendorProject, prPollInterval } = config;
  const [prMap, setPrMap] = useState<BranchPrMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    if (!provider || !provider.isConfigured(vendorAuth, vendorProject)) return;
    setLoading(true);
    provider
      .fetchPullRequests(vendorAuth, vendorProject)
      .then((map) => {
        if (mountedRef.current) {
          setPrMap(map);
          setError(null);
        }
      })
      .catch((err: Error) => {
        logError(`fetchPullRequests [${provider.id}]`, err);
        if (mountedRef.current) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [vendorAuth, vendorProject, provider]);

  useEffect(() => {
    mountedRef.current = true;
    if (!provider || !provider.isConfigured(vendorAuth, vendorProject)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch must trigger on mount
    refresh();
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
