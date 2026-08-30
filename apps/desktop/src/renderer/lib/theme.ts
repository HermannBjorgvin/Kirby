import { useSyncExternalStore } from 'react';
import type { ThemePreference } from '../../host/contract.js';

export type { ThemePreference };
export type ResolvedTheme = 'light' | 'dark';

/**
 * Theme store. The persisted source of truth is the host's desktop
 * prefs file (so the native menu's Theme radio and the window chrome
 * agree with us); localStorage is only a first-paint cache so the
 * right class is on <html> before the bridge answers.
 */
const STORAGE_KEY = 'kirby.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

let preference: ThemePreference = readStored();

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // storage unavailable
  }
  return 'system';
}

export function resolveTheme(
  pref: ThemePreference = preference
): ResolvedTheme {
  if (pref === 'system') return media.matches ? 'dark' : 'light';
  return pref;
}

function apply(): void {
  const resolved = resolveTheme();
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
  for (const l of listeners) l();
}

function setLocal(pref: ThemePreference): void {
  preference = pref;
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // ignore
  }
  apply();
}

export function setThemePreference(pref: ThemePreference): void {
  setLocal(pref);
  void window.kirby?.setDesktopPrefs({ theme: pref }).catch(() => undefined);
}

export function getThemePreference(): ThemePreference {
  return preference;
}

media.addEventListener('change', () => {
  if (preference === 'system') apply();
});

/** Call once at startup so the first paint already has the right class;
 *  then reconcile with the host's persisted preference. */
export function initTheme(): void {
  apply();
  void window.kirby
    ?.getDesktopPrefs()
    .then((p) => {
      if (p.theme !== preference) setLocal(p.theme);
    })
    .catch(() => undefined);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
} {
  const pref = useSyncExternalStore(subscribe, getThemePreference);
  const resolved = useSyncExternalStore(subscribe, () => resolveTheme());
  return { preference: pref, resolved, setPreference: setThemePreference };
}
