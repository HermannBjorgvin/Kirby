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

// ── Two-context split ────────────────────────────────────────────
//
// Resolve context: data + pure lookups. Re-renders when the active
// preset or custom overrides change. Consumers that only need to
// render hint labels or resolve keypresses subscribe here.
//
// Actions context: stable callbacks (setPreset, updateBinding,
// resetBinding). The value reference is memoized across re-renders,
// so subscribers that never read state don't re-render on every
// keystroke.
//
// Mirrors the same split used by ToastContext.

export interface KeybindResolveValue {
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
  /** Check if an action has a custom override */
  isCustom: (actionId: string) => boolean;
}

export interface KeybindActionsValue {
  /** Change the active preset */
  setPreset: (presetId: string) => void;
  /** Update a single binding (custom override) */
  updateBinding: (actionId: string, descriptors: KeyDescriptor[]) => void;
  /** Reset a single binding to preset default */
  resetBinding: (actionId: string) => void;
}

/**
 * Combined state+actions shape. Kept for call sites (input handlers)
 * that bundle both reads and writes into a single `keybinds` prop —
 * those consumers aren't inside the React render tree, so there's no
 * re-render cost to composing the two hooks at the call site.
 */
export type KeybindContextValue = KeybindResolveValue & KeybindActionsValue;

const KeybindResolveContext = createContext<KeybindResolveValue | null>(null);
const KeybindActionsContext = createContext<KeybindActionsValue | null>(null);

export function KeybindProvider({ children }: { children: ReactNode }) {
  const { config, updateKeybindFields } = useConfig();

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

  const isCustom = useCallback(
    (actionId: string) => {
      return overrides != null && actionId in overrides;
    },
    [overrides]
  );

  const setPreset = useCallback(
    (presetId: string) => {
      if (!PRESETS.find((p) => p.id === presetId)) return;
      updateKeybindFields((prev) => ({ ...prev, keybindPreset: presetId }));
    },
    [updateKeybindFields]
  );

  const updateBinding = useCallback(
    (actionId: string, descriptors: KeyDescriptor[]) => {
      updateKeybindFields((prev) => {
        const prevOverrides =
          (prev.keybindOverrides as Record<string, KeyDescriptor[]>) ?? {};
        return {
          ...prev,
          keybindOverrides: { ...prevOverrides, [actionId]: descriptors },
        };
      });
    },
    [updateKeybindFields]
  );

  const resetBinding = useCallback(
    (actionId: string) => {
      updateKeybindFields((prev) => {
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
    },
    [updateKeybindFields]
  );

  const resolveValue = useMemo<KeybindResolveValue>(
    () => ({
      presetId: preset.id,
      presetName: preset.name,
      bindings: mergedBindings,
      resolve,
      getHintKeys,
      getNavKeys,
      getHints,
      isCustom,
    }),
    [
      preset,
      mergedBindings,
      resolve,
      getHintKeys,
      getNavKeys,
      getHints,
      isCustom,
    ]
  );

  const actionsValue = useMemo<KeybindActionsValue>(
    () => ({ setPreset, updateBinding, resetBinding }),
    [setPreset, updateBinding, resetBinding]
  );

  return (
    <KeybindResolveContext.Provider value={resolveValue}>
      <KeybindActionsContext.Provider value={actionsValue}>
        {children}
      </KeybindActionsContext.Provider>
    </KeybindResolveContext.Provider>
  );
}

/**
 * Read the merged keybindings, resolver, hint helpers, and preset
 * identity. Re-renders when the active preset or any custom override
 * changes. Use this from components that render hints or route
 * keypresses to actions.
 */
export function useKeybindResolve(): KeybindResolveValue {
  const ctx = useContext(KeybindResolveContext);
  if (!ctx)
    throw new Error('useKeybindResolve must be used within KeybindProvider');
  return ctx;
}

/**
 * Read the preset/binding mutators. Stable references — subscribers
 * don't re-render when the active preset or bindings change. Use from
 * input handlers or settings UIs that only dispatch.
 */
export function useKeybindActions(): KeybindActionsValue {
  const ctx = useContext(KeybindActionsContext);
  if (!ctx)
    throw new Error('useKeybindActions must be used within KeybindProvider');
  return ctx;
}

/**
 * Combined reader — subscribes to both contexts. Use ONLY at call
 * sites that package keybinds into a single object to hand to an
 * imperative handler (see MainTab's useInput). Render-path components
 * should pick the narrower hook: useKeybindResolve for hints/lookups,
 * useKeybindActions for dispatch-only.
 */
export function useKeybinds(): KeybindContextValue {
  const resolve = useKeybindResolve();
  const actions = useKeybindActions();
  return useMemo(() => ({ ...resolve, ...actions }), [resolve, actions]);
}
