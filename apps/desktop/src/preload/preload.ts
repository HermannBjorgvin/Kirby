import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  SESSION_EVENTS,
  type KirbyHostApi,
  type SessionDataEvent,
  type SessionExitEvent,
} from '../host/contract.js';

/**
 * The only channel between the sandboxed renderer and the host
 * process. Everything exposed here must be part of the KirbyHostApi
 * contract — the renderer gets exactly this object as window.kirby.
 */
const api: KirbyHostApi = {
  getVersion: () => ipcRenderer.invoke(IPC.getVersion),

  openRepo: (cwd) => ipcRenderer.invoke(IPC.openRepo, cwd),
  getRepo: () => ipcRenderer.invoke(IPC.getRepo),
  listRecentRepos: () => ipcRenderer.invoke(IPC.listRecentRepos),
  selectRepoDirectory: () => ipcRenderer.invoke(IPC.selectRepoDirectory),
  forgetRecent: (cwd) => ipcRenderer.invoke(IPC.forgetRecent, cwd),

  getConfig: () => ipcRenderer.invoke(IPC.getConfig),
  getSettingsView: () => ipcRenderer.invoke(IPC.getSettingsView),
  updateSettingsField: (ref, value) =>
    ipcRenderer.invoke(IPC.updateSettingsField, ref, value),

  getSidebarModel: () => ipcRenderer.invoke(IPC.getSidebarModel),
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

  launchAgent: (req) => ipcRenderer.invoke(IPC.launchAgent, req),
  listSessions: () => ipcRenderer.invoke(IPC.listSessions),
  writeSession: (name, data) =>
    ipcRenderer.invoke(IPC.writeSession, name, data),
  resizeSession: (name, cols, rows) =>
    ipcRenderer.invoke(IPC.resizeSession, name, cols, rows),
  killSession: (name) => ipcRenderer.invoke(IPC.killSession, name),

  onSessionData: (cb) => {
    const listener = (_e: unknown, payload: SessionDataEvent) => cb(payload);
    ipcRenderer.on(SESSION_EVENTS.data, listener);
    return () => ipcRenderer.removeListener(SESSION_EVENTS.data, listener);
  },
  onSessionExit: (cb) => {
    const listener = (_e: unknown, payload: SessionExitEvent) => cb(payload);
    ipcRenderer.on(SESSION_EVENTS.exit, listener);
    return () => ipcRenderer.removeListener(SESSION_EVENTS.exit, listener);
  },

  fetchDiffText: (sourceBranch, targetBranch) =>
    ipcRenderer.invoke(IPC.fetchDiffText, sourceBranch, targetBranch),
  fetchFileDiffText: (sourceBranch, targetBranch, file) =>
    ipcRenderer.invoke(IPC.fetchFileDiffText, sourceBranch, targetBranch, file),
};

contextBridge.exposeInMainWorld('kirby', api);
