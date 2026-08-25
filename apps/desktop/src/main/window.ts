import type { BrowserWindowConstructorOptions } from 'electron';

/**
 * Web preferences for the Kirby renderer window.
 *
 * Security posture: the renderer is an untrusted web context (it
 * renders remote content like PR comments), so it gets no Node access
 * whatsoever and runs in the Chromium sandbox. All host capabilities
 * go through the typed preload bridge (see src/host/contract.ts); the
 * preload only needs `electron` (contextBridge/ipcRenderer), which
 * sandboxed preloads are allowed to require.
 */
export function rendererWebPreferences(
  preloadPath: string
): NonNullable<BrowserWindowConstructorOptions['webPreferences']> {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

/** Title-bar / background chrome matched to the OS colour scheme so the
 *  first paint and the native window controls don't flash the wrong
 *  theme. Values mirror the renderer's `--titlebar` tokens. */
export function windowChrome(
  dark: boolean
): Pick<
  BrowserWindowConstructorOptions,
  'backgroundColor' | 'titleBarStyle' | 'titleBarOverlay'
> {
  const bar = dark ? '#181818' : '#f8f8f8';
  const symbol = dark ? '#cccccc' : '#3b3b3b';
  return {
    backgroundColor: dark ? '#1f1f1f' : '#ffffff',
    titleBarStyle: 'hidden',
    // 35 = the title bar's 36px minus its 1px bottom border, so the
    // overlay controls centre on the visible bar instead of straddling
    // the border.
    titleBarOverlay: { color: bar, symbolColor: symbol, height: 35 },
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
