import {
  createWorktree,
  deleteBranch,
  listWorktrees,
  removeWorktree,
  worktreeSessionName,
} from '@kirby/worktree-manager';
import { killSession } from '../pty-registry.js';

// ── Session workspaces ───────────────────────────────────────────
//
// One interface for where sessions and their worktrees live. The local
// implementation wraps the worktree-manager calls Kirby has always
// used; a beam-host implementation manages worktrees on a remote
// machine through the beam CLI. All active implementations feed the
// sidebar together — the session list is their merged output.
//
// Ownership is decided by the session key itself: local sessions keep
// their bare name, sessions on a beam host are keyed `<host>:<name>`,
// so a local and a remote session on the same branch cannot collide
// and every key names its owner.

export interface WorkspaceRow {
  /** Registry + sidebar key: bare for local, `<host>:<name>` for remote. */
  name: string;
  branch?: string;
  /** Mirrors `WorktreeInfo.state` — set when the worktree is mid-rebase. */
  state?: 'rebasing';
  /** The beam host the session lives on; absent for local rows. */
  host?: string;
}

export interface SessionWorkspaces {
  /** The beam host this implementation manages, or null for the local one. */
  host: string | null;
  /** Ensure a workspace for the branch; the returned path is the spawn
   *  cwd (a path on the host for remote workspaces). Null on failure. */
  prepare(branch: string): Promise<string | null>;
  /** Inventory rows for the sidebar. */
  list(): Promise<WorkspaceRow[]>;
  /** Full teardown: agent, worktree, branch — in whatever order the
   *  implementation needs. */
  remove(sessionName: string, branch: string): Promise<void>;
}

export const localWorkspaces: SessionWorkspaces = {
  host: null,
  async prepare(branch) {
    return createWorktree(branch);
  },
  async list() {
    const worktrees = await listWorktrees();
    return worktrees.map((wt) => ({
      name: worktreeSessionName(wt),
      ...(wt.branch ? { branch: wt.branch } : {}),
      ...(wt.state ? { state: wt.state } : {}),
    }));
  },
  async remove(sessionName, branch) {
    killSession(sessionName);
    await removeWorktree(branch, { force: true });
    await deleteBranch(branch, true);
  },
};

let active: SessionWorkspaces[] = [localWorkspaces];

/** Swap the active set. Installed from config at startup, the same way
 *  setSessionBackendFactory and setWorktreeResolver are. */
export function setSessionWorkspaces(list: SessionWorkspaces[]): void {
  active = list;
}

export function getSessionWorkspaces(): SessionWorkspaces[] {
  return active;
}

/**
 * The workspace that owns a session, read off the key: `<host>:<name>`
 * belongs to that host's workspace, everything else to the local one.
 * Falls back to local when the named host is not active (a stale row
 * after a config change) so callers always get an implementation.
 */
export function workspaceForSession(name: string): SessionWorkspaces {
  const i = name.indexOf(':');
  if (i !== -1) {
    const host = name.slice(0, i);
    const ws = active.find((w) => w.host === host);
    if (ws) return ws;
  }
  return active.find((w) => w.host === null) ?? localWorkspaces;
}
