import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  MENU_EVENTS,
  SESSION_EVENTS,
  SYNC_EVENTS,
  type KirbyHostApi,
  type MenuCommandEvent,
  type SessionDataEvent,
  type SessionExitEvent,
  type SyncNoticeEvent,
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
  getSyncState: () => ipcRenderer.invoke(IPC.getSyncState),
  refreshRemote: () => ipcRenderer.invoke(IPC.refreshRemote),
  listWorktrees: () => ipcRenderer.invoke(IPC.listWorktrees),
  listBranches: () => ipcRenderer.invoke(IPC.listBranches),
  listAllBranches: () => ipcRenderer.invoke(IPC.listAllBranches),
  createWorktree: (branch) => ipcRenderer.invoke(IPC.createWorktree, branch),
  removeWorktree: (branch, force) =>
    ipcRenderer.invoke(IPC.removeWorktree, branch, force),
  canRemoveBranch: (branch) => ipcRenderer.invoke(IPC.canRemoveBranch, branch),
  openInEditor: (branch) => ipcRenderer.invoke(IPC.openInEditor, branch),

  fetchPullRequests: () => ipcRenderer.invoke(IPC.fetchPullRequests),
  fetchCommentThreads: (prId) =>
    ipcRenderer.invoke(IPC.fetchCommentThreads, prId),
  replyToThread: (req) => ipcRenderer.invoke(IPC.replyToThread, req),
  setThreadResolved: (req) => ipcRenderer.invoke(IPC.setThreadResolved, req),
  fetchCommentImage: (url) => ipcRenderer.invoke(IPC.fetchCommentImage, url),
  listDraftComments: (prId) => ipcRenderer.invoke(IPC.listDraftComments, prId),
  updateDraftComment: (prId, id, patch) =>
    ipcRenderer.invoke(IPC.updateDraftComment, prId, id, patch),
  deleteDraftComment: (prId, id) =>
    ipcRenderer.invoke(IPC.deleteDraftComment, prId, id),
  postDraftComments: (req) => ipcRenderer.invoke(IPC.postDraftComments, req),

  launchAgent: (req) => ipcRenderer.invoke(IPC.launchAgent, req),
  launchReviewAgent: (req) => ipcRenderer.invoke(IPC.launchReviewAgent, req),
  listSessions: () => ipcRenderer.invoke(IPC.listSessions),
  getSessionActivity: () => ipcRenderer.invoke(IPC.getSessionActivity),
  markSessionSeen: (name) => ipcRenderer.invoke(IPC.markSessionSeen, name),
  getSessionBuffer: (name) => ipcRenderer.invoke(IPC.getSessionBuffer, name),
  writeSession: (name, data) =>
    ipcRenderer.invoke(IPC.writeSession, name, data),
  resizeSession: (name, cols, rows) =>
    ipcRenderer.invoke(IPC.resizeSession, name, cols, rows),
  killSession: (name) => ipcRenderer.invoke(IPC.killSession, name),
  fetchPrDescription: (prId) =>
    ipcRenderer.invoke(IPC.fetchPrDescription, prId),
  submitReviewVerdict: (prId, verdict) =>
    ipcRenderer.invoke(IPC.submitReviewVerdict, prId, verdict),

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

  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  showContextMenu: (items) => ipcRenderer.invoke(IPC.showContextMenu, items),
  showAppMenu: () => ipcRenderer.invoke(IPC.showAppMenu),
  onMenuCommand: (cb) => {
    const listener = (_e: unknown, payload: MenuCommandEvent) => cb(payload);
    ipcRenderer.on(MENU_EVENTS.command, listener);
    return () => ipcRenderer.removeListener(MENU_EVENTS.command, listener);
  },
  onSyncNotice: (cb) => {
    const listener = (_e: unknown, payload: SyncNoticeEvent) => cb(payload);
    ipcRenderer.on(SYNC_EVENTS.notice, listener);
    return () => ipcRenderer.removeListener(SYNC_EVENTS.notice, listener);
  },
  getDesktopPrefs: () => ipcRenderer.invoke(IPC.getDesktopPrefs),
  setDesktopPrefs: (patch) => ipcRenderer.invoke(IPC.setDesktopPrefs, patch),
  showAbout: () => ipcRenderer.invoke(IPC.showAbout),
};

contextBridge.exposeInMainWorld('kirby', api);
