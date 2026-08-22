import { useCallback, useEffect, useRef } from 'react';
import type { BranchPrMap } from '@kirby/vcs-core';
import { logError } from '@kirby/logger';
import { useConfig } from '../context/ConfigContext.js';
import { useToastActions } from '../context/ToastContext.js';
import { usePolling } from './usePolling.js';

export function usePrData(refreshInterval = 60000) {
  const { config, provider } = useConfig();
  const { flash } = useToastActions();
  const { vendorAuth, vendorProject, prPollInterval } = config;

  const enabled =
    provider != null && provider.isConfigured(vendorAuth, vendorProject);

  const fetchPrs = useCallback(async (): Promise<BranchPrMap> => {
    if (!enabled || !provider) return {};
    try {
      return await provider.fetchPullRequests(vendorAuth, vendorProject);
    } catch (err: unknown) {
      logError(`fetchPullRequests [${provider.id}]`, err as Error);
      throw err;
    }
  }, [enabled, provider, vendorAuth, vendorProject]);

  const polling = usePolling<BranchPrMap>(
    fetchPrs,
    prPollInterval ?? refreshInterval,
    enabled
  );

  // Toast on new error messages only — the poll fires the same
  // callback every interval, so without this guard a persistent
  // failure would re-flash forever.
  const lastFlashedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const message = polling.error?.message ?? null;
    if (message === null) {
      lastFlashedErrorRef.current = null;
      return;
    }
    if (lastFlashedErrorRef.current !== message) {
      lastFlashedErrorRef.current = message;
      flash(`PR error: ${message}`, 'error');
    }
  }, [polling.error, flash]);

  return {
    prMap: polling.value ?? {},
    loading: polling.loading,
    error: polling.error?.message ?? null,
    refresh: polling.refresh,
  };
}
