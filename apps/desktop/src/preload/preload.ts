import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type KirbyHostApi } from '../host/contract.js';

/**
 * The only channel between the sandboxed renderer and the host
 * process. Everything exposed here must be part of the KirbyHostApi
 * contract — the renderer gets exactly this object as window.kirby.
 */
const api: KirbyHostApi = {
  getVersion: () => ipcRenderer.invoke(IPC.getVersion),
};

contextBridge.exposeInMainWorld('kirby', api);
