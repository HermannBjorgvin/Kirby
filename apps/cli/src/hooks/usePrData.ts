import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchPullRequestsWithComments,
  isAdoConfigured,
} from "@workflow-manager/azure-devops";
import type { AdoConfig } from "@workflow-manager/azure-devops";
import type { BranchPrMap, Config } from "@workflow-manager/shared-types";

export function usePrData(config: Config, refreshInterval = 60000) {
  const [prMap, setPrMap] = useState<BranchPrMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    if (!isAdoConfigured(config)) return;
    const adoConfig: AdoConfig = {
      org: config.org!,
      project: config.project!,
      repo: config.repo!,
      pat: config.pat!,
    };
    setLoading(true);
    fetchPullRequestsWithComments(adoConfig)
      .then((map) => {
        if (mountedRef.current) {
          setPrMap(map);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (mountedRef.current) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [config]);

  useEffect(() => {
    mountedRef.current = true;
    if (!isAdoConfigured(config)) return;
    refresh();
    const interval = setInterval(refresh, config.prPollInterval ?? refreshInterval);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [config, refresh, refreshInterval]);

  return { prMap, loading, error, refresh };
}
