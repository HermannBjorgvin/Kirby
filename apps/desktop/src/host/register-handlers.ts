import type { KirbyHostApi, ReplyRequest, ResolveRequest } from './contract.js';
import { IPC } from './contract.js';
import * as repo from './services/repo.js';
import * as config from './services/config.js';
import * as worktrees from './services/worktrees.js';
import * as reviews from './services/reviews.js';
import * as sessions from './services/sessions.js';

/**
 * The main-process implementation of the host contract. Pure data
 * plumbing — every method delegates to a service module so business
 * logic stays testable without Electron.
 */
export function createHostApi(): KirbyHostApi {
  return {
    getVersion: () =>
      Promise.resolve({
        app: process.env.KIRBY_DESKTOP_VERSION ?? 'dev',
        electron: process.versions.electron ?? 'unknown',
        node: process.versions.node,
        chrome: process.versions.chrome ?? 'unknown',
      }),

    openRepo: (cwd) => Promise.resolve(repo.openRepo(cwd)),
    getRepo: () => Promise.resolve(repo.getRepo()),

    getConfig: () => Promise.resolve(config.getConfig()),
    updateSettingsField: (field, value) =>
      Promise.resolve(config.updateSettingsField(field, value)),

    listWorktrees: () => worktrees.listWorktrees(),
    listBranches: () => worktrees.listBranches(),
    createWorktree: (branch) => worktrees.createWorktree(branch),
    removeWorktree: (branch, force) => worktrees.removeWorktree(branch, force),
    canRemoveBranch: (branch) => worktrees.canRemoveBranch(branch),

    fetchPullRequests: () => reviews.fetchPullRequests(),
    fetchCommentThreads: (prId) => reviews.fetchCommentThreads(prId),
    replyToThread: (req: ReplyRequest) => reviews.replyToThread(req),
    setThreadResolved: (req: ResolveRequest) => reviews.setThreadResolved(req),

    launchAgent: (req) => sessions.launchAgent(req),
    listSessions: () => Promise.resolve(sessions.listSessions()),
    writeSession: (name, data) =>
      Promise.resolve(sessions.writeSession(name, data)),
    resizeSession: (name, cols, rows) =>
      Promise.resolve(sessions.resizeSession(name, cols, rows)),
    killSession: (name) => Promise.resolve(sessions.killSession(name)),
    onSessionData: () => {
      // Events are pushed via setSessionBroadcaster; the preload side
      // subscribes directly to ipcRenderer events. Nothing to do here.
      return () => undefined;
    },
    onSessionExit: () => () => undefined,

    fetchDiffText: (sourceBranch, targetBranch) =>
      reviews.getDiffText(sourceBranch, targetBranch),
    fetchFileDiffText: (sourceBranch, targetBranch, file) =>
      reviews.getFileDiffText(sourceBranch, targetBranch, file),
  };
}

/** Minimal structural subset of Electron's ipcMain we rely on. */
export interface IpcRegistrar {
  handle(channel: string, fn: (...args: unknown[]) => unknown): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type HostMethod = (...args: any[]) => unknown;

/**
 * Register one ipcMain handler per contract channel. Handlers are
 * wrapped so rejections cross the IPC boundary with their message
 * intact (Electron otherwise strips custom error fields).
 */
export function registerHostHandlers(
  register: IpcRegistrar,
  api: KirbyHostApi = createHostApi()
): void {
  const handlers: Record<string, HostMethod | undefined> = {
    [IPC.getVersion]: api.getVersion as HostMethod,
    [IPC.openRepo]: api.openRepo as HostMethod,
    [IPC.getRepo]: api.getRepo as HostMethod,
    [IPC.getConfig]: api.getConfig as HostMethod,
    [IPC.updateSettingsField]: api.updateSettingsField as HostMethod,
    [IPC.listWorktrees]: api.listWorktrees as HostMethod,
    [IPC.listBranches]: api.listBranches as HostMethod,
    [IPC.createWorktree]: api.createWorktree as HostMethod,
    [IPC.removeWorktree]: api.removeWorktree as HostMethod,
    [IPC.canRemoveBranch]: api.canRemoveBranch as HostMethod,
    [IPC.launchAgent]: api.launchAgent as HostMethod,
    [IPC.listSessions]: api.listSessions as HostMethod,
    [IPC.writeSession]: api.writeSession as HostMethod,
    [IPC.resizeSession]: api.resizeSession as HostMethod,
    [IPC.killSession]: api.killSession as HostMethod,
    [IPC.fetchPullRequests]: api.fetchPullRequests as HostMethod,
    [IPC.fetchCommentThreads]: api.fetchCommentThreads as HostMethod,
    [IPC.replyToThread]: api.replyToThread as HostMethod,
    [IPC.setThreadResolved]: api.setThreadResolved as HostMethod,
    [IPC.fetchDiffText]: api.fetchDiffText as HostMethod,
    [IPC.fetchFileDiffText]: api.fetchFileDiffText as HostMethod,
  };

  for (const [channel, fn] of Object.entries(handlers)) {
    if (!fn) throw new Error(`No host implementation for ${channel}`);
    register.handle(channel, async (...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => unknown)(...args);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(message);
      }
    });
  }
}
