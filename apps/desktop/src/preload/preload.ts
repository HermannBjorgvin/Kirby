import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type KirbyHostApi } from '../host/contract.js';

/**
 * The only channel between the sandboxed renderer and the host
 * process. Everything exposed here must be part of the KirbyHostApi
 * contract — the renderer gets exactly this object as window.kirby.
 */
const api: KirbyHostApi = {
  getVersion: () => ipcRenderer.invoke(IPC.getVersion),

  openRepo: (cwd) => ipcRenderer.invoke(IPC.openRepo, cwd),
  getRepo: () => ipcRenderer.invoke(IPC.getRepo),

  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  updateSettingsField: (field, value) =>
    ipcRenderer.invoke(IPC.updateSettingsField, field, value),

  listWorktrees: () => ipcRenderer.invoke(IPC.listWorktrees),
  listBranches: () => ipcRenderer.invoke(IPC.listBranches),
  createWorktree: (branch) => ipcRenderer.invoke(IPC.createWorktree, branch),
  removeWorktree: (branch, force) =>
    ipcRenderer.invoke(IPC.removeWorktree, branch, force),
  canRemoveBranch: (branch) => ipcRenderer.invoke(IPC.canRemoveBranch, branch),

  fetchPullRequests: () => ipcRenderer.invoke(IPC.fetchPullRequests),
  fetchCommentThreads: (prId) =>
    ipcRenderer.invoke(IPC.fetchCommentThreads, prId),
  replyToThread: (req) => ipcRenderer.invoke(IPC.replyToThread, req),
  setThreadResolved: (req) => ipcRenderer.invoke(IPC.setThreadResolved, req),

  fetchDiffText: (sourceBranch, targetBranch) =>
    ipcRenderer.invoke(IPC.fetchDiffText, sourceBranch, targetBranch),
  fetchFileDiffText: (sourceBranch, targetBranch, file) =>
    ipcRenderer.invoke(IPC.fetchFileDiffText, sourceBranch, targetBranch, file),
};

contextBridge.exposeInMainWorld('kirby', api);
