import { useSyncExternalStore } from 'react';
import type { DesktopPrefs } from '../../host/contract.js';

/** Renderer mirror of the host's desktop prefs (loaded once at boot). */
let prefs: DesktopPrefs = { theme: 'system', nativeFrame: false };
const listeners = new Set<() => void>();

export async function loadDesktopPrefs(): Promise<DesktopPrefs> {
  try {
    prefs = await window.kirby.getDesktopPrefs();
  } catch {
    // keep defaults
  }
  for (const l of listeners) l();
  return prefs;
}

export async function updateDesktopPrefs(
  patch: Partial<DesktopPrefs>
): Promise<void> {
  prefs = await window.kirby.setDesktopPrefs(patch);
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useDesktopPrefs(): DesktopPrefs {
  return useSyncExternalStore(subscribe, () => prefs);
}

export const isMacPlatform =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
