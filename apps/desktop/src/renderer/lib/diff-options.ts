import { useSyncExternalStore } from 'react';

/** Viewer-wide diff preferences, persisted per machine. */
export interface DiffOptions {
  view: 'unified' | 'split';
  wrap: boolean;
  hideResolved: boolean;
}

const KEY = 'kirby.diff.options';
const DEFAULTS: DiffOptions = {
  view: 'unified',
  wrap: false,
  hideResolved: false,
};
const listeners = new Set<() => void>();

let options: DiffOptions = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw
      ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<DiffOptions>) }
      : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
})();

export function setDiffOptions(patch: Partial<DiffOptions>): void {
  options = { ...options, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(options));
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useDiffOptions(): DiffOptions {
  return useSyncExternalStore(subscribe, () => options);
}
