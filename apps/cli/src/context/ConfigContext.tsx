import {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
} from 'react';
import type { ReactNode } from 'react';
import {
  readConfig,
  readGlobalConfig,
  writeGlobalConfig,
  readProjectConfig,
  writeProjectConfig,
  isVcsConfigured,
} from '@kirby/vcs-core';
import type { AppConfig, VcsProvider } from '@kirby/vcs-core';
import type { SettingsField } from '../components/SettingsPanel.js';

/** Subset of AppConfig persisted via keybind mutators (see updateKeybindFields) */
export type KeybindFields = Pick<
  AppConfig,
  'keybindPreset' | 'keybindOverrides'
>;

/** Persist keybind fields to global config in a single write. */
function persistKeybindFields(config: AppConfig): void {
  const g = readGlobalConfig();
  g.keybindPreset = config.keybindPreset;
  g.keybindOverrides = config.keybindOverrides;
  writeGlobalConfig(g);
}

// ── Config value coercion ────────────────────────────────────────

/** Coerce a string value to the correct type for known config keys */
function coerceConfigValue(
  key: string,
  value: string | undefined
): string | boolean | number | undefined {
  if (value === undefined) return undefined;
  if (
    key === 'autoDeleteOnMerge' ||
    key === 'autoRebase' ||
    key === 'autoHideSidebar'
  ) {
    return value === 'true';
  }
  if (key === 'mergePollInterval' || key === 'prPollInterval') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return value;
}

/** Update a config field in memory, returning a new AppConfig */
export function updateConfigField(
  config: AppConfig,
  field: SettingsField,
  value: string | undefined
): AppConfig {
  switch (field.configBag) {
    case 'global':
    case 'project':
      return {
        ...config,
        [field.key]: coerceConfigValue(field.key, value),
      } as AppConfig;
    case 'vendorAuth':
      return {
        ...config,
        vendorAuth: { ...config.vendorAuth, [field.key]: value ?? '' },
      };
    case 'vendorProject':
      return {
        ...config,
        vendorProject: { ...config.vendorProject, [field.key]: value ?? '' },
      };
  }
}

/** Persist a single settings field to the correct config file */
export function persistConfigField(
  field: SettingsField,
  value: string | undefined,
  config: AppConfig
): void {
  switch (field.configBag) {
    case 'global': {
      const g = readGlobalConfig();
      (g as Record<string, unknown>)[field.key] = coerceConfigValue(
        field.key,
        value
      );
      writeGlobalConfig(g);
      break;
    }
    case 'project': {
      const p = readProjectConfig();
      (p as Record<string, unknown>)[field.key] = coerceConfigValue(
        field.key,
        value
      );
      writeProjectConfig(p);
      break;
    }
    case 'vendorAuth': {
      const g = readGlobalConfig();
      const vendor = config.vendor;
      if (vendor) {
        if (!g.vendorAuth) g.vendorAuth = {};
        if (!g.vendorAuth[vendor]) g.vendorAuth[vendor] = {};
        g.vendorAuth[vendor]![field.key] = value ?? '';
        writeGlobalConfig(g);
      }
      break;
    }
    case 'vendorProject': {
      const p = readProjectConfig();
      if (!p.vendorProject) p.vendorProject = {};
      p.vendorProject[field.key] = value ?? '';
      writeProjectConfig(p);
      break;
    }
  }
}

// ── Context ──────────────────────────────────────────────────────

export interface ConfigContextValue {
  config: AppConfig;
  provider: VcsProvider | null;
  providers: VcsProvider[];
  vcsConfigured: boolean;
  updateField: (field: SettingsField, value: string | undefined) => void;
  /**
   * Update keybind-related fields and persist them to global config in a
   * single write. Callers return the new values for `keybindPreset` and/or
   * `keybindOverrides`; everything else on `AppConfig` is preserved.
   */
  updateKeybindFields: (
    updater: (prev: KeybindFields) => KeybindFields
  ) => void;
  /** Re-read the on-disk config into state (e.g. after auto-detect wrote). */
  reloadFromDisk: () => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({
  providers,
  children,
}: {
  providers: VcsProvider[];
  children: ReactNode;
}) {
  const [config, setConfig] = useState<AppConfig>(() => readConfig());

  const provider = useMemo<VcsProvider | null>(() => {
    if (!config.vendor) return null;
    return providers.find((p) => p.id === config.vendor) ?? null;
  }, [config.vendor, providers]);

  const vcsConfigured = isVcsConfigured(config, provider);

  const updateField = useCallback(
    (field: SettingsField, value: string | undefined) => {
      let updated!: AppConfig;
      setConfig((prev) => {
        updated = updateConfigField(prev, field, value);
        return updated;
      });
      // Defer sync disk I/O off the React render call stack
      const capturedField = field;
      const capturedValue = value;
      const capturedConfig = updated;
      queueMicrotask(() => {
        persistConfigField(capturedField, capturedValue, capturedConfig);
      });
    },
    []
  );

  const updateKeybindFields = useCallback(
    (updater: (prev: KeybindFields) => KeybindFields) => {
      let next!: AppConfig;
      setConfig((prev) => {
        const patch = updater({
          keybindPreset: prev.keybindPreset,
          keybindOverrides: prev.keybindOverrides,
        });
        next = { ...prev, ...patch };
        return next;
      });
      queueMicrotask(() => {
        persistKeybindFields(next);
      });
    },
    []
  );

  const reloadFromDisk = useCallback(() => {
    setConfig(readConfig());
  }, []);

  const value = useMemo<ConfigContextValue>(
    () => ({
      config,
      provider,
      providers,
      vcsConfigured,
      updateField,
      updateKeybindFields,
      reloadFromDisk,
    }),
    [
      config,
      provider,
      providers,
      vcsConfigured,
      updateField,
      updateKeybindFields,
      reloadFromDisk,
    ]
  );

  return (
    <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
  );
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}
