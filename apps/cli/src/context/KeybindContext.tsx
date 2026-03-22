import { createContext, useContext, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Key } from 'ink';
import { useConfig } from './ConfigContext.js';
import {
  ACTIONS,
  PRESETS,
  getPreset,
  resolveAction,
  getHintsForContext,
  keysToDisplayString,
  getNavHintKeys,
} from '../keybindings/index.js';
import type {
  InputContext,
  KeyDescriptor,
  HintEntry,
} from '../keybindings/index.js';
import { readGlobalConfig, writeGlobalConfig } from '@kirby/vcs-core';

// ── Context ──────────────────────────────────────────────────────

export interface KeybindContextValue {
  /** The active preset ID */
  presetId: string;
  /** The active preset's display name */
  presetName: string;
  /** The merged bindings (preset + custom overrides) */
  bindings: Record<string, KeyDescriptor[]>;
  /** Resolve a keypress to an action ID in a given context */
  resolve: (input: string, key: Key, context: InputContext) => string | null;
  /** Get the display key(s) for a given action (e.g. "j/Down") */
  getHintKeys: (actionId: string) => string;
  /** Get combined nav keys for a context (e.g. "j/k" or "Down/Up") */
  getNavKeys: (contextPrefix: string) => string;
  /** Get all hint entries for a context */
  getHints: (context: InputContext) => HintEntry[];
  /** Change the active preset */
  setPreset: (presetId: string) => void;
  /** Update a single binding (custom override) */
  updateBinding: (actionId: string, descriptors: KeyDescriptor[]) => void;
  /** Reset a single binding to preset default */
  resetBinding: (actionId: string) => void;
  /** Check if an action has a custom override */
  isCustom: (actionId: string) => boolean;
}

const KeybindContext = createContext<KeybindContextValue | null>(null);

export function KeybindProvider({ children }: { children: ReactNode }) {
  const { config, setConfig } = useConfig();

  const preset = useMemo(
    () => getPreset(config.keybindPreset),
    [config.keybindPreset]
  );

  // Merge preset bindings with custom overrides
  const overrides = config.keybindOverrides as
    | Record<string, KeyDescriptor[]>
    | undefined;

  const mergedBindings = useMemo(() => {
    if (!overrides || Object.keys(overrides).length === 0) {
      return preset.bindings;
    }
    return { ...preset.bindings, ...overrides };
  }, [preset, overrides]);

  const resolve = useCallback(
    (input: string, key: Key, context: InputContext) =>
      resolveAction(input, key, context, mergedBindings, ACTIONS),
    [mergedBindings]
  );

  const getHintKeys = useCallback(
    (actionId: string) => {
      const descs = mergedBindings[actionId];
      if (!descs || descs.length === 0) return '?';
      return keysToDisplayString(descs);
    },
    [mergedBindings]
  );

  const getNavKeys = useCallback(
    (contextPrefix: string) => getNavHintKeys(contextPrefix, mergedBindings),
    [mergedBindings]
  );

  const getHints = useCallback(
    (context: InputContext) =>
      getHintsForContext(context, ACTIONS, mergedBindings),
    [mergedBindings]
  );

  const setPreset = useCallback(
    (presetId: string) => {
      if (!PRESETS.find((p) => p.id === presetId)) return;
      setConfig((prev) => ({ ...prev, keybindPreset: presetId }));
      queueMicrotask(() => {
        const g = readGlobalConfig();
        g.keybindPreset = presetId;
        writeGlobalConfig(g);
      });
    },
    [setConfig]
  );

  const updateBinding = useCallback(
    (actionId: string, descriptors: KeyDescriptor[]) => {
      setConfig((prev) => {
        const prevOverrides =
          (prev.keybindOverrides as Record<string, KeyDescriptor[]>) ?? {};
        const newOverrides = { ...prevOverrides, [actionId]: descriptors };
        return { ...prev, keybindOverrides: newOverrides };
      });
      queueMicrotask(() => {
        const g = readGlobalConfig();
        const existing =
          (g.keybindOverrides as Record<string, KeyDescriptor[]>) ?? {};
        g.keybindOverrides = { ...existing, [actionId]: descriptors };
        writeGlobalConfig(g);
      });
    },
    [setConfig]
  );

  const resetBinding = useCallback(
    (actionId: string) => {
      setConfig((prev) => {
        const prevOverrides =
          (prev.keybindOverrides as Record<string, KeyDescriptor[]>) ?? {};
        const rest = Object.fromEntries(
          Object.entries(prevOverrides).filter(([k]) => k !== actionId)
        );
        return {
          ...prev,
          keybindOverrides: Object.keys(rest).length > 0 ? rest : undefined,
        };
      });
      queueMicrotask(() => {
        const g = readGlobalConfig();
        const existing =
          (g.keybindOverrides as Record<string, unknown[]>) ?? {};
        const filtered = Object.fromEntries(
          Object.entries(existing).filter(([k]) => k !== actionId)
        );
        g.keybindOverrides =
          Object.keys(filtered).length > 0 ? filtered : undefined;
        writeGlobalConfig(g);
      });
    },
    [setConfig]
  );

  const isCustom = useCallback(
    (actionId: string) => {
      return overrides != null && actionId in overrides;
    },
    [overrides]
  );

  const value = useMemo<KeybindContextValue>(
    () => ({
      presetId: preset.id,
      presetName: preset.name,
      bindings: mergedBindings,
      resolve,
      getHintKeys,
      getNavKeys,
      getHints,
      setPreset,
      updateBinding,
      resetBinding,
      isCustom,
    }),
    [
      preset,
      mergedBindings,
      resolve,
      getHintKeys,
      getNavKeys,
      getHints,
      setPreset,
      updateBinding,
      resetBinding,
      isCustom,
    ]
  );

  return (
    <KeybindContext.Provider value={value}>{children}</KeybindContext.Provider>
  );
}

export function useKeybinds(): KeybindContextValue {
  const ctx = useContext(KeybindContext);
  if (!ctx) throw new Error('useKeybinds must be used within KeybindProvider');
  return ctx;
}
