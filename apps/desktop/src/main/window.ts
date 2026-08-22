import type { BrowserWindowConstructorOptions } from 'electron';

/**
 * Web preferences for the Kirby renderer window.
 *
 * Security posture: the renderer is an untrusted web context (it
 * renders remote content like PR comments), so it gets no Node access
 * whatsoever. All host capabilities go through the typed preload
 * bridge (see src/host/contract.ts).
 *
 * `sandbox: false` is required because our preload uses `import` from
 * 'electron' via the bundled CJS shim; it still has no Node access
 * since contextIsolation is on and only the bridge API is exposed.
 */
export function rendererWebPreferences(
  preloadPath: string
): NonNullable<BrowserWindowConstructorOptions['webPreferences']> {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  };
}

/** Where the window loads its content from. */
export type LoadTarget =
  | { kind: 'dev-server'; url: string }
  | { kind: 'file'; path: string };

export function loadTarget(
  devServerUrl: string | undefined,
  indexHtmlPath: string
): LoadTarget {
  if (devServerUrl) {
    return { kind: 'dev-server', url: devServerUrl };
  }
  return { kind: 'file', path: indexHtmlPath };
}
