import { useEffect, useState } from 'react';
import type { VcsProvider } from '@kirby/vcs-core';
import { checkGhAuth } from '@kirby/vcs-github';
import { useConfig } from '../../context/ConfigContext.js';
import type { SettingsField } from '../SettingsPanel.js';

/**
 * For GitHub providers, attempt to read the user's username from the
 * `gh auth` CLI state and auto-fill it into the vendorProject.username
 * field when it isn't already set. Returns `{ ghUsername, ghChecked }`
 * so callers can show a detected-username hint on the fields step.
 */
export function useGithubAutodetect(provider: VcsProvider | null): {
  ghUsername: string | null;
  ghChecked: boolean;
} {
  const { config, updateField } = useConfig();
  const [ghUsername, setGhUsername] = useState<string | null>(null);
  const [ghChecked, setGhChecked] = useState(false);

  useEffect(() => {
    if (provider?.id !== 'github') return;
    let cancelled = false;
    checkGhAuth().then((result) => {
      if (cancelled) return;
      setGhChecked(true);
      if (result.authenticated && result.username) {
        setGhUsername(result.username);
        if (!config.vendorProject.username) {
          const field: SettingsField = {
            label: 'GitHub Username',
            key: 'username',
            configBag: 'vendorProject',
          };
          updateField(field, result.username);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [provider, config.vendorProject.username, updateField]);

  return { ghUsername, ghChecked };
}
