/**
 * Typed contract between the Electron main process and the renderer.
 *
 * The preload script exposes exactly this shape as `window.kirby` via
 * contextBridge; the main process implements it behind ipcMain
 * handlers. Both sides import these types from this file so the
 * compiler keeps the bridge honest.
 */

export interface KirbyVersionInfo {
  /** kirby-desktop package version */
  app: string;
  electron: string;
  node: string;
  chrome: string;
}

/** The API surface exposed on `window.kirby`. */
export interface KirbyHostApi {
  getVersion(): Promise<KirbyVersionInfo>;
}

/** IPC channel names — single source of truth for main and preload. */
export const IPC = {
  getVersion: 'kirby/version',
} as const;
